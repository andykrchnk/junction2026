import { TRPCError } from '@trpc/server';
import { setTimeout as delay } from 'node:timers/promises';
import { db } from '../../db';
import { Env } from '../../shared/env';
import { getDrawing, processDrawing } from './operations';
import { detectDrawing } from './detection';
import { processBlueprint } from './blueprint-processing';
import { InferenceError } from './inference';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 3;

// One embedded job is atomically committed with the attachment on upload.
export async function enqueueDrawing(id: string, ownerId: string, page?: number) {
    const drawing = await getDrawing(id, ownerId);
    if (drawing.processing?.status === 'queued' || drawing.processing?.status === 'running') return drawing;
    if (page !== undefined && !drawing.blueprints.some((blueprint) => blueprint.pageNumber === page))
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid blueprint page.' });
    const pages = drawing.blueprints
        .filter((blueprint) => blueprint.status.type !== 'ready' && (page === undefined || blueprint.pageNumber === page))
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
        { $set: { processingJob: db.drawing.createProcessingJob(pages), error: null } },
    );
    return getDrawing(id, ownerId);
}

// Exported for operational checks and a future dedicated worker process.
export async function processNextJob(shutdown: AbortSignal): Promise<boolean> {
    if (shutdown.aborted) return false;
    const now = new Date();
    const token = crypto.randomUUID();
    const doc = await db.drawing.DrawingModel.findOneAndUpdate(
        {
            'processingJob.availableAt': { $lte: now },
            $or: [
                {
                    'processingJob.status': 'queued',
                    $and: [
                        { $or: [{ lease: null }, { leaseUntil: { $lte: now } }] },
                        { $or: [{ inferenceLease: null }, { inferenceLeaseUntil: { $lte: now } }] },
                    ],
                },
                { 'processingJob.status': 'running', 'processingJob.leaseUntil': { $lte: now } },
            ],
        },
        {
            $set: {
                'processingJob.status': 'running',
                'processingJob.lease': token,
                'processingJob.leaseUntil': new Date(Date.now() + LEASE_MS),
                lease: null,
                leaseUntil: null,
                inferenceLease: null,
                inferenceLeaseUntil: null,
                error: null,
            },
            $inc: { 'processingJob.attempts': 1 },
        },
        { returnDocument: 'after', sort: { 'processingJob.availableAt': 1 } },
    ).lean();
    if (!doc) return false;
    const drawing = db.drawing.DrawingDto(doc);
    const job = db.drawing.StoredJobZod.parse(doc.processingJob);
    const owned = { _id: drawing.id, ownerId: doc.ownerId, 'processingJob.lease': token, 'processingJob.status': 'running' };
    const page = job.pages[job.cursor];
    const controller = new AbortController();
    const signal = AbortSignal.any([shutdown, controller.signal]);
    let renewing = false;
    const heartbeat = setInterval(() => {
        if (renewing || signal.aborted) return;
        renewing = true;
        void db.drawing.DrawingModel.updateOne(
            { ...owned, 'processingJob.leaseUntil': { $gt: new Date() } },
            { $set: { 'processingJob.leaseUntil': new Date(Date.now() + LEASE_MS) } },
        )
            .then((result) => {
                if (!result.matchedCount) controller.abort();
            })
            .catch(() => controller.abort())
            .finally(() => {
                renewing = false;
            });
    }, 15_000);
    heartbeat.unref();
    let advance = false;
    let failed = false;
    let backpressure = false;
    try {
        if (page === undefined) {
            advance = true;
            return true;
        }
        const blueprint = drawing.blueprints.find((item) => item.pageNumber === page);
        if (!blueprint) {
            advance = true;
            return true;
        }
        if (blueprint.status.type === 'ready') {
            advance = true;
            return true;
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
        if (signal.aborted) return true; // Lease expiry/shutdown leaves a resumable claim.
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
        clearInterval(heartbeat);
        if (!signal.aborted) {
            const cursor = job.cursor + (advance ? 1 : 0);
            await db.drawing.DrawingModel.updateOne(
                { ...owned, 'processingJob.leaseUntil': { $gt: new Date() } },
                {
                    $set: {
                        'processingJob.status': cursor >= job.pages.length ? 'completed' : 'queued',
                        'processingJob.cursor': cursor,
                        'processingJob.attempts': backpressure ? Math.max(0, job.attempts - 1) : advance || !failed ? 0 : job.attempts,
                        'processingJob.availableAt': new Date(Date.now() + (backpressure ? 30_000 : failed && !advance ? 5000 * job.attempts : 0)),
                        'processingJob.lease': null,
                        'processingJob.leaseUntil': null,
                    },
                },
            );
        }
    }
    return true;
}

export function startDrawingWorker() {
    const controller = new AbortController();
    const run = async () => {
        while (!controller.signal.aborted) {
            try {
                if (await processNextJob(controller.signal)) continue;
            } catch {
                // Keep the durable claim for expiry recovery; never log provider data or credentials.
                console.error('Drawing worker could not complete a polling cycle; it will retry.');
            }
            await delay(2000, undefined, { signal: controller.signal }).catch(() => {});
        }
    };
    const done = Promise.all(Array.from({ length: Env.DRAWING_PROCESSING_CONCURRENCY }, () => run()));
    return {
        stop: async () => {
            controller.abort();
            await done;
        },
    };
}
