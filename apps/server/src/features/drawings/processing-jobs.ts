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

// Agenda owns scheduling and exclusive job claims; this token fences saved results.
async function processDrawingStage(data: z.infer<typeof JobDataZod>, signal: AbortSignal) {
    if (signal.aborted) return;
    const token = crypto.randomUUID();
    const doc = await db.drawing.DrawingModel.findOneAndUpdate(
        {
            _id: data.drawingId,
            'processingJob.id': data.runId,
            'processingJob.status': { $in: ['queued', 'running'] },
            'processingJob.availableAt': { $lte: new Date() },
        },
        {
            $set: {
                'processingJob.status': 'running',
                'processingJob.lease': token,
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
    try {
        if (page === undefined) {
            advance = true;
            return;
        }
        const blueprint = drawing.blueprints.find((item) => item.pageNumber === page);
        if (!blueprint) {
            advance = true;
            return;
        }
        if (!blueprintNeedsAnalysis(blueprint)) {
            advance = true;
            return;
        }
        if (job.attempts > MAX_ATTEMPTS) throw new Error('Repeatedly interrupted processing');
        if (!blueprint.layout || !blueprint.raster) {
            const updated = await detectDrawing({ id: drawing.id, ownerId: doc.ownerId, page, job: { lease: token, signal } });
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
                async (current, stageSignal, lease) => {
                    await processBlueprint({ drawing: current, ownerId: doc.ownerId, signal: stageSignal, lease, blueprintId: blueprint.id, jobLease: token });
                    return {};
                },
                { lease: token, signal },
            );
            advance = updated.blueprints.find((item) => item.pageNumber === page)?.status.type === 'ready';
        }
    } catch (cause) {
        if (signal.aborted) return; // Shutdown leaves the saved checkpoint for the next Agenda invocation.
        failed = true;
        backpressure = cause instanceof TRPCError && cause.cause instanceof InferenceError && cause.cause.busy;
        const current = await getDrawing(drawing.id, doc.ownerId);
        const blueprint = current.blueprints.find((item) => item.pageNumber === page);
        advance = !backpressure && (blueprint?.status.type === 'rejected' || job.attempts >= MAX_ATTEMPTS);
        if (advance && blueprint && !['failed', 'partial', 'rejected'].includes(blueprint.status.type)) {
            await db.drawing.DrawingModel.updateOne(
                { ...owned, 'blueprints.id': blueprint.id },
                {
                    $set: {
                        'blueprints.$.status': {
                            type: 'failed',
                            stage: blueprint.layout ? 'misc' : 'inference',
                            error: 'Processing failed repeatedly. Retry this page to resume.',
                        },
                    },
                },
            );
        }
    } finally {
        if (!signal.aborted) {
            const cursor = job.cursor + (advance ? 1 : 0);
            await db.drawing.DrawingModel.updateOne(
                owned,
                [
                    {
                        $set: {
                            'processingJob.status': { $cond: [{ $gte: [cursor, { $size: '$processingJob.pages' }] }, 'completed', 'queued'] },
                            'processingJob.cursor': cursor,
                            'processingJob.attempts': backpressure ? Math.max(0, job.attempts - 1) : advance || !failed ? 0 : job.attempts,
                            'processingJob.availableAt': new Date(Date.now() + (backpressure ? 30_000 : failed && !advance ? 5000 * job.attempts : 0)),
                            'processingJob.lease': null,
                        },
                    },
                ],
                { updatePipeline: true },
            );
        }
    }
}

export async function startDrawingWorker() {
    const controller = new AbortController();
    const agenda = new Agenda({
        backend: new MongoBackend({ mongo: database, collection: QUEUE_COLLECTION }),
        processEvery: '1 second',
        maxConcurrency: Env.DRAWING_PROCESSING_CONCURRENCY + 1,
        // Do not pre-lock a backlog that another backend could process.
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
        {
            concurrency: Env.DRAWING_PROCESSING_CONCURRENCY,
            lockLimit: Env.DRAWING_PROCESSING_CONCURRENCY,
            // Each stage has a 120s/240s provider deadline. Leave room for rasterization/storage.
            lockLifetime: 10 * 60_000,
            backoff: () => 5000,
        },
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
                const progress = db.drawing.StoredJobZod.parse(doc.processingJob);
                await agenda
                    .create(DRAWING_JOB, { drawingId: doc._id.toHexString(), runId: progress.id })
                    .unique({ name: DRAWING_JOB, 'data.runId': progress.id }, { insertOnly: true })
                    // Persist a next run before executing, so killed workers resume after lock expiry.
                    .repeatEvery('1 second')
                    .schedule(progress.availableAt)
                    .save();
            }
        },
        { concurrency: 1, lockLimit: 1, lockLifetime: 60_000 },
    );
    // Unique upserts alone do not guarantee uniqueness when multiple replicas reconcile.
    await database.collection(QUEUE_COLLECTION).createIndex({ name: 1, 'data.runId': 1 }, { unique: true, partialFilterExpression: { name: DRAWING_JOB } });
    await agenda.every('2 seconds', RECONCILE_JOB);
    await agenda.start();
    return {
        stop: async () => {
            controller.abort();
            // Wait for aborted handlers to settle before releasing their locks/DB connection.
            await agenda.drain({ closeConnection: false });
        },
    };
}
