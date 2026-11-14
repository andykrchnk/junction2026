import { ObjectId, BSON } from 'mongodb';
import { TRPCError } from '@trpc/server';
import { hasDetailedEntityDescription, blueprintNeedsAnalysis, type Drawing, type LayoutRoom, type LayoutFixture, type ScanComments } from '@repo/types';
import { db } from '../../db';
import { blueprintFiles } from './files';
import { inspectBlueprint, enrichEntity } from './blueprint-agent';
import { estimatePpm } from './ppm-agent';
import { resolvePpm } from './ppm-resolution-agent';
import { createPpmComments } from './ppm-comments';

type ProcessBlueprintParams = Readonly<{ drawing: Drawing; ownerId: string; signal: AbortSignal; lease: string }>;

function previousDescription(entity: LayoutRoom | LayoutFixture) {
    if (entity.enrichment.type === 'complete') return entity.enrichment.result;
    return entity.enrichment.type === 'processing' || entity.enrichment.type === 'failed' ? entity.enrichment.previousResult : null;
}

// Reset calibration without replacing user comments that may be written concurrently.
export async function resetBlueprintPpm(params: Readonly<{ drawingId: string; ownerId: string; lease: string; blueprintId: string }>) {
    const result = await db.drawing.DrawingModel.updateOne(
        { _id: params.drawingId, ownerId: params.ownerId, lease: params.lease, leaseUntil: { $gt: new Date() }, 'blueprints.id': params.blueprintId },
        {
            $set: { 'blueprints.$.ppm': null, 'blueprints.$.ppmCandidates': null, 'blueprints.$.status': { type: 'pending', stage: 'ppm' } },
            $pull: { 'blueprints.$.comments': { source: 'ppm' } },
        },
    );
    if (!result.matchedCount) throw new TRPCError({ code: 'CONFLICT', message: 'Calibration reset expired. Retry.' });
}

// One bounded stage per request. The client resumes until every blueprint is ready.
export async function processBlueprint(params: ProcessBlueprintParams) {
    const { drawing, ownerId, signal, lease } = params;
    const blueprint = drawing.blueprints.find(blueprintNeedsAnalysis);
    if (!blueprint) return;
    if (!blueprint.raster || !blueprint.layout) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Complete inference before blueprint analysis.' });
    const owned = {
        _id: drawing.id,
        ownerId,
        lease,
        blueprints: { $elemMatch: { id: blueprint.id, 'layout.revision': blueprint.layout.revision } },
    };
    const root = `blueprints.$`;
    const save = async (fields: Record<string, unknown>, comments: ScanComments = [], processingPath?: string) => {
        signal.throwIfAborted();
        // Include concurrent comments and prior entity checkpoints when enforcing the BSON budget.
        const current = await db.drawing.DrawingModel.findOne({ _id: drawing.id, ownerId }).lean();
        if (!current || BSON.calculateObjectSize(current) + BSON.calculateObjectSize({ fields, comments }) > 15 * 1024 * 1024) {
            throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Blueprint context exceeds this session’s supported size.' });
        }
        signal.throwIfAborted();
        const result = await db.drawing.DrawingModel.updateOne(
            {
                ...owned,
                ...(processingPath ? { blueprints: { $elemMatch: { ...owned.blueprints.$elemMatch, [processingPath]: 'processing' } } } : {}),
                leaseUntil: { $gt: new Date() },
            },
            {
                $set: Object.fromEntries(Object.entries(fields).map(([path, value]) => [`${root}.${path}`, value])),
                ...(comments.length ? { $push: { [`${root}.comments`]: { $each: comments } } } : {}),
            },
        );
        if (!result.matchedCount) throw new TRPCError({ code: 'CONFLICT', message: 'Blueprint processing expired or its layout changed. Retry.' });
    };
    const stage =
        blueprint.misc === null
            ? 'misc'
            : [...blueprint.layout.rooms, ...blueprint.layout.fixtures].some((entity) => !hasDetailedEntityDescription(entity))
              ? 'entities'
              : 'ppm';
    await save({ status: { type: 'processing', stage } });
    try {
        const chunks: Buffer[] = [];
        for await (const chunk of blueprintFiles.openDownloadStream(new ObjectId(blueprint.raster.fileId))) {
            signal.throwIfAborted();
            chunks.push(Buffer.from(chunk));
        }
        const bytes = Buffer.concat(chunks);
        if (stage === 'misc') {
            const context = await inspectBlueprint(blueprint, bytes, signal);
            await save({
                misc: context.misc,
                'layout.summary': context.summary,
                'layout.limitations': [...blueprint.layout.limitations, ...context.limitations],
                status: { type: 'pending', stage: 'entities' },
            });
            return;
        }
        if (stage === 'entities') {
            if (blueprint.ppm !== null || blueprint.ppmCandidates !== null) {
                await resetBlueprintPpm({ drawingId: drawing.id, ownerId, lease, blueprintId: blueprint.id });
                await save({ status: { type: 'processing', stage: 'entities' } });
            }
            const rooms = blueprint.layout.rooms.map((entity, index) => ({ kind: 'room' as const, collection: 'rooms', entity, index }));
            const fixtures = blueprint.layout.fixtures.map((entity, index) => ({ kind: 'fixture' as const, collection: 'fixtures', entity, index }));
            // Finish rooms before fixtures, so fixture requests can consume saved room context.
            const pending: { kind: 'room' | 'fixture'; collection: string; entity: LayoutRoom | LayoutFixture; index: number }[] = rooms.some(
                ({ entity }) => !hasDetailedEntityDescription(entity),
            )
                ? rooms
                : fixtures;
            const batch = pending.filter(({ entity }) => !hasDetailedEntityDescription(entity)).slice(0, 3);
            await save(
                Object.fromEntries(
                    batch.map(({ collection, index, entity }) => [
                        `layout.${collection}.${index}.enrichment`,
                        { type: 'processing', startedAt: new Date().toISOString(), previousResult: previousDescription(entity) },
                    ]),
                ),
            );
            const outcomes = await Promise.allSettled(
                batch.map(async ({ kind, collection, entity, index }) => {
                    try {
                        const enrichment = await enrichEntity({ blueprint, entity, kind, bytes, signal });
                        await save({ [`layout.${collection}.${index}.enrichment`]: enrichment });
                    } catch (cause) {
                        if (!signal.aborted)
                            // Do not replace a completed checkpoint when its write acknowledgement was lost.
                            await save(
                                {
                                    [`layout.${collection}.${index}.enrichment`]: {
                                        type: 'failed',
                                        error: 'Entity analysis failed. Retry to resume.',
                                        previousResult: previousDescription(entity),
                                    },
                                },
                                [],
                                `layout.${collection}.${index}.enrichment.type`,
                            );
                        throw cause;
                    }
                }),
            );
            const failure = outcomes.find((outcome) => outcome.status === 'rejected');
            if (failure?.status === 'rejected') {
                if (failure.reason instanceof TRPCError) throw failure.reason;
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Some entity analyses failed. Completed results are saved; retry to resume.' });
            }
            await save({ status: { type: 'pending', stage: 'entities' } });
            return;
        }
        const pages = [{ page: blueprint.pageNumber, width: blueprint.raster.width, height: blueprint.raster.height, bytes }];
        if (blueprint.ppmCandidates === null) {
            const candidates = await estimatePpm({ pages, blueprint, signal });
            await save(
                { ppmCandidates: candidates, status: { type: 'pending', stage: 'ppm' } },
                createPpmComments({ candidates, createdAt: new Date().toISOString() }),
            );
            return;
        }
        if (blueprint.ppm === null) {
            const ppm = await resolvePpm({ blueprint, messages: drawing.messages, pages, signal });
            await save({ ppm, status: { type: 'ready' } });
        } else {
            await save({ status: { type: 'ready' } });
        }
    } catch (cause) {
        // Even an expired/aborted call must leave a retryable checkpoint, without changing completed entities.
        const error = cause instanceof TRPCError ? cause.message : 'Blueprint analysis failed or timed out. Retry to resume.';
        await db.drawing.DrawingModel.updateOne(
            { ...owned, leaseUntil: { $gt: new Date() } },
            { $set: { [`${root}.status`]: { type: 'partial', stage, error } } },
        );
        throw new TRPCError({ code: cause instanceof TRPCError ? cause.code : 'INTERNAL_SERVER_ERROR', message: error, cause });
    }
}
