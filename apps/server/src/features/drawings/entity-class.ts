import { TRPCError } from '@trpc/server';
import { BlueprintLayoutZod, type EntityDescription, type LayoutRoom, type UpdateEntityClass } from '@repo/types';
import { db } from '../../db';
import { getDrawing } from './operations';

export async function updateEntityClass(input: UpdateEntityClass, ownerId: string) {
    const drawing = await getDrawing(input.id, ownerId);
    const blueprint = drawing.blueprints.find((item) => item.id === input.blueprintId);
    const layout = blueprint?.layout;
    if (!layout || !(input.kind === 'room' ? layout.rooms : layout.fixtures).some((entity) => entity.id === input.entityId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Detected element not found.' });
    }
    if (drawing.busy || layout.revision !== input.revision) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Drawing is processing or has changed. Refresh and retry.' });
    }

    // Preserve AI observations, but detach opening references invalidated by the corrected class.
    const reconcileDescription = (result: EntityDescription): EntityDescription => {
        if (!result.details || input.kind !== 'fixture') return result;
        return {
            ...result,
            details: {
                ...result.details,
                windows: result.details.windows.map((finding) =>
                    finding.objectId === input.entityId && input.class !== 'Window' ? { ...finding, objectId: null } : finding,
                ),
                doors: result.details.doors.map((finding) =>
                    finding.objectId === input.entityId && input.class !== 'Door' ? { ...finding, objectId: null } : finding,
                ),
            },
        };
    };
    const reconcileEnrichment = (enrichment: LayoutRoom['enrichment']): LayoutRoom['enrichment'] => {
        if (enrichment.type === 'complete') return { ...enrichment, result: reconcileDescription(enrichment.result) };
        if ((enrichment.type === 'failed' || enrichment.type === 'processing') && enrichment.previousResult) {
            return { ...enrichment, previousResult: reconcileDescription(enrichment.previousResult) };
        }
        return enrichment;
    };
    const updatedLayout = BlueprintLayoutZod.parse({
        ...layout,
        revision: crypto.randomUUID(),
        rooms: layout.rooms.map((entity) => ({
            ...entity,
            ...(input.kind === 'room' && entity.id === input.entityId ? { class: input.class } : {}),
            enrichment: reconcileEnrichment(entity.enrichment),
        })),
        fixtures: layout.fixtures.map((entity) => ({
            ...entity,
            ...(input.kind === 'fixture' && entity.id === input.entityId ? { class: input.class } : {}),
            enrichment: reconcileEnrichment(entity.enrichment),
        })),
    });
    const doc = await db.drawing.DrawingModel.findOneAndUpdate(
        {
            _id: input.id,
            ownerId,
            blueprints: { $elemMatch: { id: input.blueprintId, 'layout.revision': input.revision } },
            'processingJob.status': { $nin: ['queued', 'running'] },
            $and: [
                { $or: [{ lease: null }, { leaseUntil: { $lte: new Date() } }] },
                { $or: [{ inferenceLease: null }, { inferenceLeaseUntil: { $lte: new Date() } }] },
            ],
        },
        { $set: { 'blueprints.$.layout': updatedLayout } },
        { returnDocument: 'after' },
    ).lean();
    if (!doc) throw new TRPCError({ code: 'CONFLICT', message: 'Drawing is processing or has changed. Refresh and retry.' });
    return db.drawing.DrawingDto(doc);
}
