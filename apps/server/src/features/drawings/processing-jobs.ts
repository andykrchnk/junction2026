import { TRPCError } from '@trpc/server';
import { Agenda } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';
import { z } from 'zod';
import { MongoIdZod, blueprintNeedsAnalysis } from '@repo/types';
import { database } from '../../db/connection';
import { db } from '../../db';
import { Env } from '../../shared/env';
import { getDrawing } from './operations';
import { detectDrawing } from './detection';
import { processBlueprint } from './blueprint-processing';
import { InferenceError } from './inference';
import { withDeadline } from './deadline';
import { blueprintJobFilter } from './blueprint-job';

const DRAWING_JOB = 'process-blueprint';
const LEGACY_DRAWING_JOB = 'process-drawing';
const RECONCILE_JOB = 'enqueue-pending-drawings';
const QUEUE_COLLECTION = 'drawingJobs';
const JobDataZod = z.object({ drawingId: MongoIdZod, runId: z.string().uuid(), page: z.number().int().positive() });
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

// Aggregate the current tasks in the same update as a page checkpoint. A sibling
// may finish or an upload may append pages while this worker is awaiting a provider.
const summarizeJob = {
    $set: {
        'processingJob.status': {
            $cond: [
                { $allElementsTrue: [{ $map: { input: '$processingJob.tasks', as: 'task', in: { $eq: ['$$task.status', 'completed'] } } }] },
                'completed',
                'running',
            ],
        },
        'processingJob.cursor': { $size: { $filter: { input: '$processingJob.tasks', as: 'task', cond: { $eq: ['$$task.status', 'completed'] } } } },
    },
};

function pageCheckpoint(page: number, fields: Record<string, unknown>) {
    return {
        $set: {
            'processingJob.tasks': {
                $map: {
                    input: '$processingJob.tasks',
                    as: 'task',
                    in: { $cond: [{ $eq: ['$$task.page', page] }, { $mergeObjects: ['$$task', { $literal: fields }] }, '$$task'] },
                },
            },
        },
    };
}

async function upgradeLegacyJob(id: string) {
    const doc = await db.drawing.DrawingModel.findOne({ _id: id, 'processingJob.tasks': { $exists: false } }).lean();
    if (!doc || !doc.processingJob) return;
    const previous = db.drawing.StoredJobZod.parse(doc.processingJob);
    if (previous.status === 'completed') return;
    const now = new Date();
    // Let a pre-upgrade worker finish its active stage before moving the run.
    if ([previous.leaseUntil, doc.leaseUntil, doc.inferenceLeaseUntil].some((deadline) => deadline && deadline > now)) return;
    if (previous.status === 'running' && !previous.leaseUntil && doc.updatedAt.getTime() + 300_000 > now.getTime()) return;
    const tasks = previous.pages.map((page, index) => ({
        ...db.drawing.createPageProcessingJob(page),
        status: index < previous.cursor ? 'completed' : 'queued',
        attempts: index === previous.cursor ? previous.attempts : 0,
    }));
    await db.drawing.DrawingModel.updateOne(
        {
            _id: doc._id,
            'processingJob.id': previous.id,
            'processingJob.pages': previous.pages,
            'processingJob.status': previous.status,
            'processingJob.lease': previous.lease,
            'processingJob.tasks': { $exists: false },
            $and: [
                { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
                { $or: [{ inferenceLeaseUntil: null }, { inferenceLeaseUntil: { $lte: now } }] },
            ],
        },
        {
            $set: {
                // A fresh ID fences jobs scheduled by the old, session-level worker.
                processingJob: { ...previous, id: crypto.randomUUID(), status: 'running', lease: null, leaseUntil: null, startedAt: null, tasks },
                lease: null,
                leaseUntil: null,
                inferenceLease: null,
                inferenceLeaseUntil: null,
                error: null,
            },
        },
    );
}

// Fence an expired page before unlocking its Agenda record. Other pages continue.
export async function recoverExpiredDrawingJob(id: string) {
    await upgradeLegacyJob(id);
    const doc = await db.drawing.DrawingModel.findOne({ _id: id, 'processingJob.status': { $in: ['queued', 'running'] } }).lean();
    if (!doc) return false;
    const progress = db.drawing.StoredJobZod.parse(doc.processingJob);
    if (!progress.tasks) return false;
    let recovered = false;
    for (const [index, task] of progress.tasks.entries()) {
        if (task.status === 'completed') continue;
        if (task.status === 'running' && task.leaseUntil && task.leaseUntil.getTime() > Date.now()) continue;
        if (task.status === 'queued' && [doc.leaseUntil, doc.inferenceLeaseUntil].some((date) => date && date.getTime() > Date.now())) continue;
        let completed = false;
        if (task.status === 'running') {
            const blueprint = doc.blueprints.find((item) => item.pageNumber === task.page);
            const saved = !blueprint || !blueprintNeedsAnalysis(blueprint);
            const exhausted = !saved && task.attempts >= MAX_ATTEMPTS;
            completed = saved || exhausted;
            const message = exhausted
                ? 'Processing timed out repeatedly. Retry incomplete pages to resume from saved results.'
                : 'Processing was interrupted. Retrying from saved results.';
            const root = `processingJob.tasks.${index}`;
            const stage = blueprint && 'stage' in blueprint.status ? blueprint.status.stage : blueprint?.layout ? 'ppm' : 'inference';
            const result = await db.drawing.DrawingModel.updateOne(
                {
                    _id: doc._id,
                    'processingJob.id': progress.id,
                    [`${root}.page`]: task.page,
                    [`${root}.status`]: 'running',
                    [`${root}.lease`]: task.lease,
                    [`${root}.leaseUntil`]: task.leaseUntil ?? null,
                },
                [
                    {
                        $set: {
                            ...pageCheckpoint(task.page, {
                                status: completed ? 'completed' : 'queued',
                                lease: null,
                                leaseUntil: null,
                                startedAt: null,
                                availableAt: new Date(),
                                lastError: saved ? null : message,
                            }).$set,
                            ...(exhausted && blueprint
                                ? {
                                      blueprints: {
                                          $map: {
                                              input: '$blueprints',
                                              as: 'blueprint',
                                              in: {
                                                  $cond: [
                                                      { $eq: ['$$blueprint.pageNumber', task.page] },
                                                      { $mergeObjects: ['$$blueprint', { $literal: { status: { type: 'failed', stage, error: message } } }] },
                                                      '$$blueprint',
                                                  ],
                                              },
                                          },
                                      },
                                  }
                                : {}),
                        },
                    },
                    summarizeJob,
                ],
                { updatePipeline: true },
            );
            if (!result.matchedCount) continue;
            recovered = true;
        }
        const queueJob = await database.collection(QUEUE_COLLECTION).findOne({
            name: DRAWING_JOB,
            'data.runId': progress.id,
            'data.page': task.page,
            lockedAt: { $lte: task.status === 'running' ? (task.startedAt ?? doc.updatedAt) : new Date(Date.now() - 10_000) },
        });
        if (queueJob) {
            const result = await database
                .collection(QUEUE_COLLECTION)
                .updateOne(
                    { _id: queueJob._id, lockedAt: queueJob.lockedAt },
                    { $set: { lockedAt: null, nextRunAt: completed ? null : task.availableAt, disabled: completed } },
                );
            recovered ||= result.modifiedCount > 0;
        }
    }
    return recovered;
}

// Each Agenda record owns one blueprint; each invocation executes one bounded stage.
async function processDrawingStage(data: z.infer<typeof JobDataZod>, signal: AbortSignal) {
    if (signal.aborted) return;
    const current = await db.drawing.DrawingModel.findOne({ _id: data.drawingId, 'processingJob.id': data.runId }).lean();
    if (!current) return;
    const progress = db.drawing.StoredJobZod.parse(current.processingJob);
    const index = progress.tasks?.findIndex((task) => task.page === data.page) ?? -1;
    if (index < 0) return;
    const target = current.blueprints.find((item) => item.pageNumber === data.page);
    const inference = target && (!target.layout || !target.raster);
    const stageTimeout = inference ? Env.INFERENCE_TIMEOUT_MS + 30_000 : 120_000;
    const startedAt = new Date();
    const token = crypto.randomUUID();
    const root = `processingJob.tasks.${index}`;
    const doc = await db.drawing.DrawingModel.findOneAndUpdate(
        {
            _id: data.drawingId,
            'processingJob.id': data.runId,
            [`${root}.page`]: data.page,
            [`${root}.status`]: 'queued',
            [`${root}.availableAt`]: { $lte: startedAt },
            $and: [
                { $or: [{ lease: null }, { leaseUntil: { $lte: startedAt } }] },
                { $or: [{ inferenceLease: null }, { inferenceLeaseUntil: { $lte: startedAt } }] },
            ],
        },
        {
            $set: {
                'processingJob.status': 'running',
                [`${root}.status`]: 'running',
                [`${root}.lease`]: token,
                [`${root}.startedAt`]: startedAt,
                [`${root}.leaseUntil`]: new Date(startedAt.getTime() + stageTimeout + 30_000),
                // The claim only matches absent/expired foreground leases.
                lease: null,
                leaseUntil: null,
                inferenceLease: null,
                inferenceLeaseUntil: null,
                activeChatMessageId: null,
                error: null,
            },
            $inc: { [`${root}.attempts`]: 1 },
        },
        { returnDocument: 'after' },
    ).lean();
    if (!doc) return;
    const drawing = db.drawing.DrawingDto(doc);
    const task = db.drawing.StoredJobZod.parse(doc.processingJob).tasks?.[index];
    if (!task) throw new Error('Claimed blueprint job is missing.');
    const job = { runId: data.runId, page: data.page, index, lease: token };
    const ownership = () => ({ _id: drawing.id, ownerId: doc.ownerId, ...blueprintJobFilter(job) });
    let advance = false;
    let failed = false;
    let backpressure = false;
    let lastError: string | null = null;
    try {
        const blueprint = drawing.blueprints.find((item) => item.pageNumber === data.page);
        if (!blueprint || !blueprintNeedsAnalysis(blueprint)) {
            advance = true;
            return;
        }
        if (task.attempts > MAX_ATTEMPTS) throw new Error('Repeatedly interrupted processing');
        if (!blueprint.layout || !blueprint.raster) {
            const updated = await withDeadline({
                signal,
                timeoutMs: stageTimeout,
                label: 'Object detection',
                run: (stageSignal) => detectDrawing({ id: drawing.id, ownerId: doc.ownerId, page: data.page, job: { ...job, signal: stageSignal } }),
            });
            advance = updated.blueprints.find((item) => item.pageNumber === data.page)?.status.type === 'not_configured';
        } else if (!Env.OPENAI_API_KEY) {
            await db.drawing.DrawingModel.updateOne(
                { ...ownership(), 'blueprints.id': blueprint.id },
                { $set: { 'blueprints.$.status': { type: 'partial', stage: 'misc', error: 'Analysis is not configured. Inference results are saved.' } } },
            );
            advance = true;
        } else {
            await withDeadline({
                signal,
                timeoutMs: stageTimeout,
                label: 'Blueprint analysis',
                run: (stageSignal) => processBlueprint({ drawing, ownerId: doc.ownerId, signal: stageSignal, lease: token, blueprintId: blueprint.id, job }),
            });
            const updated = await getDrawing(drawing.id, doc.ownerId);
            advance = updated.blueprints.find((item) => item.pageNumber === data.page)?.status.type === 'ready';
        }
    } catch (cause) {
        failed = true;
        lastError = signal.aborted
            ? 'Processing was interrupted. Retrying from saved results.'
            : 'Processing failed or timed out. Retrying from saved results.';
        backpressure = cause instanceof TRPCError && cause.cause instanceof InferenceError && cause.cause.busy;
        const currentDrawing = await getDrawing(drawing.id, doc.ownerId);
        const blueprint = currentDrawing.blueprints.find((item) => item.pageNumber === data.page);
        advance = !backpressure && (blueprint?.status.type === 'rejected' || task.attempts >= MAX_ATTEMPTS);
        if (advance && blueprint && blueprint.status.type !== 'rejected') {
            lastError = 'Processing failed repeatedly. Retry incomplete pages to resume from saved results.';
            const stage = 'stage' in blueprint.status ? blueprint.status.stage : blueprint.layout ? 'ppm' : 'inference';
            await db.drawing.DrawingModel.updateOne(
                { ...ownership(), 'blueprints.id': blueprint.id },
                { $set: { 'blueprints.$.status': { type: 'failed', stage, error: lastError } } },
            );
        }
    } finally {
        await db.drawing.DrawingModel.updateOne(
            ownership(),
            [
                pageCheckpoint(data.page, {
                    status: advance ? 'completed' : 'queued',
                    attempts: backpressure ? Math.max(0, task.attempts - 1) : advance || !failed ? 0 : task.attempts,
                    availableAt: new Date(Date.now() + (signal.aborted ? 0 : backpressure ? 1000 : failed && !advance ? 5000 * task.attempts : 0)),
                    lease: null,
                    leaseUntil: null,
                    startedAt: null,
                    lastError,
                }),
                summarizeJob,
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
    // Old records remain for history, but only page-level jobs run on this worker.
    await database.collection(QUEUE_COLLECTION).updateMany({ name: LEGACY_DRAWING_JOB }, { $set: { disabled: true } });
    agenda.define(LEGACY_DRAWING_JOB, async (job) => {
        job.disable();
        await job.save();
    });
    agenda.define<unknown>(
        DRAWING_JOB,
        async (job) => {
            const data = JobDataZod.parse(job.attrs.data);
            if (!controller.signal.aborted) await processDrawingStage(data, controller.signal);
            const doc = await db.drawing.DrawingModel.findOne({ _id: data.drawingId, 'processingJob.id': data.runId }).select('processingJob').lean();
            const task = doc ? db.drawing.StoredJobZod.parse(doc.processingJob).tasks?.find((task) => task.page === data.page) : null;
            if (!task || task.status === 'completed') job.disable();
            else job.schedule(task.availableAt);
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
                if (!progress || progress.status === 'completed' || !progress.tasks) continue;
                for (const task of progress.tasks) {
                    if (task.status === 'completed') continue;
                    await agenda
                        .create(DRAWING_JOB, { drawingId: doc._id.toHexString(), runId: progress.id, page: task.page })
                        .unique({ name: DRAWING_JOB, 'data.runId': progress.id, 'data.page': task.page }, { insertOnly: true })
                        .repeatEvery('1 second')
                        .schedule(task.availableAt)
                        .save();
                }
            }
        },
        { concurrency: 1, lockLimit: 1, lockLifetime: 60_000 },
    );
    await database
        .collection(QUEUE_COLLECTION)
        .createIndex({ name: 1, 'data.runId': 1, 'data.page': 1 }, { unique: true, partialFilterExpression: { name: DRAWING_JOB } });
    await agenda.every('2 seconds', RECONCILE_JOB);
    await agenda.start();
    return {
        stop: async () => {
            controller.abort();
            await agenda.drain({ closeConnection: false });
        },
    };
}
