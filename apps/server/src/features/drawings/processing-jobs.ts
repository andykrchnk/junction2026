import { TRPCError } from '@trpc/server';
import { Agenda } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';
import { z } from 'zod';
import { MongoIdZod, blueprintNeedsAnalysis } from '@repo/types';
import { database } from '../../db/connection';
import { db } from '../../db';
import { Env } from '../../shared/env';
import { getDrawing, processDrawing } from './operations';
import { detectDrawing } from './detection';
import { processBlueprint } from './blueprint-processing';
import { InferenceError } from './inference';
import { withDeadline } from './deadline';

const DRAWING_JOB = 'process-drawing';
const RECONCILE_JOB = 'enqueue-pending-drawings';
const QUEUE_COLLECTION = 'drawingJobs';
const JobDataZod = z.object({ drawingId: MongoIdZod, runId: z.string().uuid() });
const MAX_ATTEMPTS = 3;

// Progress doubles as an outbox record, atomically committed with uploaded pages.
export async function enqueueDrawing(id: string, ownerId: string, page?: number, retryPpm = false) {
    const drawing = await getDrawing(id, ownerId);
    if (drawing.processing?.status === 'queued' || drawing.processing?.status === 'running') return drawing;
    if (page !== undefined && !drawing.blueprints.some((blueprint) => blueprint.pageNumber === page))
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid blueprint page.' });
    if (retryPpm && drawing.blueprints.some((blueprint) => !blueprint.layout || !blueprint.raster))
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Complete inference before retrying calibration.' });
    const pages = drawing.blueprints
        .filter((blueprint) => (retryPpm || blueprintNeedsAnalysis(blueprint)) && (page === undefined || blueprint.pageNumber === page))
        .map((blueprint) => blueprint.pageNumber);
    if (!pages.length) return drawing;
    await db.drawing.DrawingModel.updateOne(
        {
            _id: id,
            ownerId,
            'processingJob.status': { $nin: ['queued', 'running'] },
            $and: [
                { $or: [{ lease: null }, { leaseUntil: { $lte: new Date() } }] },
                { $or: [{ inferenceLease: null }, { inferenceLeaseUntil: { $lte: new Date() } }] },
            ],
        },
        {
            $set: {
                processingJob: db.drawing.createProcessingJob(pages),
                error: null,
                ...(retryPpm
                    ? {
                          'blueprints.$[].ppm': null,
                          'blueprints.$[].ppmCandidates': null,
                          'blueprints.$[].status': { type: 'pending', stage: 'ppm' },
                      }
                    : {}),
            },
            ...(retryPpm ? { $pull: { 'blueprints.$[].comments': { source: 'ppm' } } } : {}),
        },
    );
    return getDrawing(id, ownerId);
}

// Recover the outbox record first, fencing the old handler before releasing its Agenda lock.
export async function recoverExpiredDrawingJob(id: string) {
    const doc = await db.drawing.DrawingModel.findOne({ _id: id, 'processingJob.status': { $in: ['queued', 'running'] } }).lean();
    if (!doc) return false;
    const progress = db.drawing.StoredJobZod.parse(doc.processingJob);
    if (progress.status === 'queued') {
        // A process may die after checkpointing/requeueing but before Agenda unlocks.
        // Give newly locked jobs time to make their queued -> running claim first.
        if ([doc.leaseUntil, doc.inferenceLeaseUntil].some((date) => date && date.getTime() > Date.now())) return false;
        const orphan = await database.collection(QUEUE_COLLECTION).findOne({
            name: DRAWING_JOB,
            'data.runId': progress.id,
            lockedAt: { $lte: new Date(Date.now() - 10_000) },
        });
        if (!orphan) return false;
        const result = await database
            .collection(QUEUE_COLLECTION)
            .updateOne({ _id: orphan._id, lockedAt: orphan.lockedAt }, { $set: { lockedAt: null, nextRunAt: progress.availableAt, disabled: false } });
        return result.modifiedCount > 0;
    }
    const deadlines = [progress.leaseUntil, doc.leaseUntil, doc.inferenceLeaseUntil].filter((value): value is Date => value instanceof Date);
    const expiresAt = deadlines.length ? Math.min(...deadlines.map((value) => value.getTime())) : doc.updatedAt.getTime() + 300_000;
    if (expiresAt > Date.now()) return false;
    const drawing = db.drawing.DrawingDto(doc);
    const page = progress.pages[progress.cursor];
    const blueprint = drawing.blueprints.find((item) => item.pageNumber === page);
    const saved = !blueprint || !blueprintNeedsAnalysis(blueprint);
    const exhausted = !saved && progress.attempts >= MAX_ATTEMPTS;
    const cursor = progress.cursor + (saved || exhausted ? 1 : 0);
    const completed = cursor >= progress.pages.length;
    const message = exhausted
        ? 'Processing timed out repeatedly. Retry incomplete pages to resume from saved results.'
        : 'Processing was interrupted. Retrying from saved results.';
    const stage = blueprint && 'stage' in blueprint.status ? blueprint.status.stage : blueprint?.layout ? 'ppm' : 'inference';
    const blueprintIndex = drawing.blueprints.findIndex((item) => item.id === blueprint?.id);
    const recovered = await db.drawing.DrawingModel.updateOne(
        {
            _id: doc._id,
            'processingJob.id': progress.id,
            'processingJob.lease': progress.lease,
            'processingJob.status': 'running',
            ...(progress.leaseUntil ? { 'processingJob.leaseUntil': progress.leaseUntil } : {}),
        },
        {
            $set: {
                'processingJob.status': completed ? 'completed' : 'queued',
                'processingJob.cursor': cursor,
                'processingJob.lease': null,
                'processingJob.leaseUntil': null,
                'processingJob.startedAt': null,
                'processingJob.availableAt': new Date(),
                'processingJob.attempts': saved || exhausted ? 0 : progress.attempts,
                'processingJob.lastError': saved ? null : message,
                lease: null,
                leaseUntil: null,
                inferenceLease: null,
                inferenceLeaseUntil: null,
                error: exhausted ? message : null,
                ...(exhausted && blueprint
                    ? {
                          [`blueprints.${blueprintIndex}.status`]: { type: 'failed', stage, error: message },
                          ...(blueprint.processingActivity
                              ? {
                                    [`blueprints.${blueprintIndex}.processingActivity`]: {
                                        ...blueprint.processingActivity,
                                        status: 'failed',
                                        updatedAt: new Date().toISOString(),
                                    },
                                }
                              : {}),
                      }
                    : {}),
            },
        },
    );
    if (!recovered.matchedCount) return false;
    // A lock acquired by a newer invocation must not be released by this recovery.
    const cutoff = progress.startedAt ?? doc.updatedAt;
    const queueJob = await database.collection(QUEUE_COLLECTION).findOne({ name: DRAWING_JOB, 'data.runId': progress.id, lockedAt: { $lte: cutoff } });
    if (queueJob)
        await database
            .collection(QUEUE_COLLECTION)
            .updateOne(
                { _id: queueJob._id, lockedAt: queueJob.lockedAt },
                { $set: { lockedAt: null, nextRunAt: completed ? null : new Date(), disabled: completed } },
            );
    return true;
}

// Agenda schedules jobs; persisted per-stage leases fence both claims and saved results.
async function processDrawingStage(data: z.infer<typeof JobDataZod>, signal: AbortSignal) {
    if (signal.aborted) return;
    const current = await db.drawing.DrawingModel.findOne({ _id: data.drawingId, 'processingJob.id': data.runId }).lean();
    if (!current) return;
    const previous = db.drawing.StoredJobZod.parse(current.processingJob);
    const target = db.drawing.DrawingDto(current).blueprints.find((item) => item.pageNumber === previous.pages[previous.cursor]);
    const inference = target && (!target.layout || !target.raster);
    const stageTimeout = inference ? Env.INFERENCE_TIMEOUT_MS + 30_000 : 120_000;
    const startedAt = new Date();
    const token = crypto.randomUUID();
    const doc = await db.drawing.DrawingModel.findOneAndUpdate(
        {
            _id: data.drawingId,
            'processingJob.id': data.runId,
            'processingJob.status': 'queued',
            'processingJob.availableAt': { $lte: startedAt },
            $and: [
                { $or: [{ lease: null }, { leaseUntil: { $lte: startedAt } }] },
                { $or: [{ inferenceLease: null }, { inferenceLeaseUntil: { $lte: startedAt } }] },
            ],
        },
        {
            $set: {
                'processingJob.status': 'running',
                'processingJob.lease': token,
                'processingJob.startedAt': startedAt,
                'processingJob.leaseUntil': new Date(startedAt.getTime() + stageTimeout + 30_000),
                lease: null,
                leaseUntil: null,
                inferenceLease: null,
                inferenceLeaseUntil: null,
                error: null,
            },
            $inc: { 'processingJob.attempts': 1 },
        },
        { returnDocument: 'after' },
    ).lean();
    if (!doc) return;
    const drawing = db.drawing.DrawingDto(doc);
    const job = db.drawing.StoredJobZod.parse(doc.processingJob);
    const owned = { _id: drawing.id, ownerId: doc.ownerId, 'processingJob.lease': token, 'processingJob.status': 'running' };
    const page = job.pages[job.cursor];
    let advance = false;
    let failed = false;
    let backpressure = false;
    let lastError: string | null = null;
    try {
        if (page === undefined) {
            advance = true;
            return;
        }
        const blueprint = drawing.blueprints.find((item) => item.pageNumber === page);
        if (!blueprint || !blueprintNeedsAnalysis(blueprint)) {
            advance = true;
            return;
        }
        if (job.attempts > MAX_ATTEMPTS) throw new Error('Repeatedly interrupted processing');
        if (!blueprint.layout || !blueprint.raster) {
            const updated = await withDeadline({
                signal,
                timeoutMs: stageTimeout,
                label: 'Object detection',
                run: (stageSignal) => detectDrawing({ id: drawing.id, ownerId: doc.ownerId, page, job: { lease: token, signal: stageSignal } }),
            });
            advance = updated.blueprints.find((item) => item.pageNumber === page)?.status.type === 'not_configured';
        } else if (!Env.OPENAI_API_KEY) {
            await db.drawing.DrawingModel.updateOne(
                { ...owned, 'blueprints.id': blueprint.id },
                { $set: { 'blueprints.$.status': { type: 'partial', stage: 'misc', error: 'Analysis is not configured. Inference results are saved.' } } },
            );
            advance = true;
        } else {
            const updated = await processDrawing(
                drawing.id,
                doc.ownerId,
                async (currentDrawing, stageSignal, lease) => {
                    await processBlueprint({
                        drawing: currentDrawing,
                        ownerId: doc.ownerId,
                        signal: stageSignal,
                        lease,
                        blueprintId: blueprint.id,
                        jobLease: token,
                    });
                    return {};
                },
                { lease: token, signal },
            );
            advance = updated.blueprints.find((item) => item.pageNumber === page)?.status.type === 'ready';
        }
    } catch (cause) {
        failed = true;
        lastError = signal.aborted
            ? 'Processing was interrupted. Retrying from saved results.'
            : 'Processing failed or timed out. Retrying from saved results.';
        backpressure = cause instanceof TRPCError && cause.cause instanceof InferenceError && cause.cause.busy;
        const currentDrawing = await getDrawing(drawing.id, doc.ownerId);
        const blueprint = currentDrawing.blueprints.find((item) => item.pageNumber === page);
        advance = !backpressure && (blueprint?.status.type === 'rejected' || job.attempts >= MAX_ATTEMPTS);
        if (advance && blueprint && blueprint.status.type !== 'rejected') {
            lastError = 'Processing failed repeatedly. Retry incomplete pages to resume from saved results.';
            const stage = 'stage' in blueprint.status ? blueprint.status.stage : blueprint.layout ? 'ppm' : 'inference';
            await db.drawing.DrawingModel.updateOne(
                { ...owned, 'blueprints.id': blueprint.id },
                { $set: { 'blueprints.$.status': { type: 'failed', stage, error: lastError }, error: lastError } },
            );
        }
    } finally {
        const cursor = job.cursor + (advance ? 1 : 0);
        await db.drawing.DrawingModel.updateOne(
            owned,
            [
                {
                    $set: {
                        'processingJob.status': { $cond: [{ $gte: [cursor, { $size: '$processingJob.pages' }] }, 'completed', 'queued'] },
                        'processingJob.cursor': cursor,
                        'processingJob.attempts': backpressure ? Math.max(0, job.attempts - 1) : advance || !failed ? 0 : job.attempts,
                        'processingJob.availableAt': new Date(
                            Date.now() + (signal.aborted ? 0 : backpressure ? 30_000 : failed && !advance ? 5000 * job.attempts : 0),
                        ),
                        'processingJob.lease': null,
                        'processingJob.leaseUntil': null,
                        'processingJob.startedAt': null,
                        'processingJob.lastError': lastError,
                        lease: null,
                        leaseUntil: null,
                        inferenceLease: null,
                        inferenceLeaseUntil: null,
                    },
                },
            ],
            { updatePipeline: true },
        );
    }
}

export async function startDrawingWorker() {
    const controller = new AbortController();
    const agenda = new Agenda({
        backend: new MongoBackend({ mongo: database, collection: QUEUE_COLLECTION }),
        processEvery: '1 second',
        maxConcurrency: Env.DRAWING_PROCESSING_CONCURRENCY + 1,
        lockLimit: Env.DRAWING_PROCESSING_CONCURRENCY + 1,
    });
    agenda.on('error', () => console.error('Drawing queue encountered an error; pending work remains durable.'));
    agenda.on('fail', () => console.error('Drawing queue job failed; it will retry.'));
    agenda.define<unknown>(
        DRAWING_JOB,
        async (job) => {
            const data = JobDataZod.parse(job.attrs.data);
            if (!controller.signal.aborted) await processDrawingStage(data, controller.signal);
            const doc = await db.drawing.DrawingModel.findOne({ _id: data.drawingId, 'processingJob.id': data.runId }).select('processingJob').lean();
            const progress = doc ? db.drawing.StoredJobZod.parse(doc.processingJob) : null;
            if (!progress || progress.status === 'completed') job.disable();
            else job.schedule(progress.availableAt);
            await job.save();
        },
        { concurrency: Env.DRAWING_PROCESSING_CONCURRENCY, lockLimit: Env.DRAWING_PROCESSING_CONCURRENCY, lockLifetime: 6 * 60_000, backoff: () => 5000 },
    );
    agenda.define(
        RECONCILE_JOB,
        async (job) => {
            let touchedAt = Date.now();
            const pending = db.drawing.DrawingModel.find({ 'processingJob.status': { $in: ['queued', 'running'] } })
                .select('processingJob')
                .lean()
                .cursor();
            for await (const doc of pending) {
                if (controller.signal.aborted) break;
                if (Date.now() - touchedAt > 15_000) {
                    await job.touch();
                    touchedAt = Date.now();
                }
                await recoverExpiredDrawingJob(doc._id.toHexString());
                const current = await db.drawing.DrawingModel.findById(doc._id).select('processingJob').lean();
                const progress = current ? db.drawing.StoredJobZod.parse(current.processingJob) : null;
                if (!progress || progress.status === 'completed') continue;
                await agenda
                    .create(DRAWING_JOB, { drawingId: doc._id.toHexString(), runId: progress.id })
                    .unique({ name: DRAWING_JOB, 'data.runId': progress.id }, { insertOnly: true })
                    .repeatEvery('1 second')
                    .schedule(progress.availableAt)
                    .save();
            }
        },
        { concurrency: 1, lockLimit: 1, lockLifetime: 60_000 },
    );
    await database.collection(QUEUE_COLLECTION).createIndex({ name: 1, 'data.runId': 1 }, { unique: true, partialFilterExpression: { name: DRAWING_JOB } });
    await agenda.every('2 seconds', RECONCILE_JOB);
    await agenda.start();
    return {
        stop: async () => {
            controller.abort();
            await agenda.drain({ closeConnection: false });
        },
    };
}
