import { TRPCError } from '@trpc/server';
import { BlueprintLayoutZod, type DeleteEntity, type EntityDescription, type LayoutRoom } from '@repo/types';
import { db } from '../../db';
import { layoutProperties } from '../../db/drawing.schema';
import { getDrawing } from './operations';

export async function deleteEntity(input: DeleteEntity, ownerId: string) {
    const drawing = await getDrawing(input.id, ownerId);
    const blueprint = drawing.blueprints.find((item) => item.id === input.blueprintId);
    const layout = blueprint?.layout;
    if (
        !layout ||
        !blueprint.raster ||
        !(input.kind === 'room' ? layout.rooms : input.kind === 'slab' ? layout.slabs : layout.fixtures).some((entity) => entity.id === input.entityId)
    ) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Detected element not found.' });
    }
    if (drawing.busy || layout.revision !== input.revision) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Drawing is processing or has changed. Refresh and retry.' });
    }
    const property = layoutProperties(layout).find((entity) => entity.id === input.entityId);
    if (!property?.bbox) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Element location is unavailable.' });
    const x = (property.bbox[0] + property.bbox[2]) / 2 / blueprint.raster.width;
    const y = (property.bbox[1] + property.bbox[3]) / 2 / blueprint.raster.height;

    // Keep observations as unlinked evidence when their detected object is removed.
    const reconcileDescription = (result: EntityDescription): EntityDescription => {
        const details = result.details;
        if (!details) return result;
        const detach = <T extends { objectId: string | null }>(finding: T): T =>
            finding.objectId === input.entityId ? { ...finding, objectId: null } : finding;
        return {
            ...result,
            details: {
                ...details,
                windows: details.windows.map(detach),
                doors: details.doors.map((door) => ({
                    ...detach(door),
                    connectedRoomIds: door.connectedRoomIds?.filter((id) => id !== input.entityId) ?? null,
                })),
                furniture: details.furniture.map(detach),
                relatedObjects: details.relatedObjects.map(detach),
                markings: details.markings.map(detach),
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
        slabs: layout.slabs.filter((entity) => entity.id !== input.entityId),
        rooms: layout.rooms
            .filter((entity) => entity.id !== input.entityId)
            .map((entity) => ({ ...entity, enrichment: reconcileEnrichment(entity.enrichment) })),
        fixtures: layout.fixtures
            .filter((entity) => entity.id !== input.entityId)
            .map((entity) => ({
                ...entity,
                roomIds: entity.roomIds.filter((id) => id !== input.entityId),
                enrichment: reconcileEnrichment(entity.enrichment),
            })),
    });
    const now = new Date();
    const doc = await db.drawing.DrawingModel.findOneAndUpdate(
        {
            _id: input.id,
            ownerId,
            blueprints: { $elemMatch: { id: input.blueprintId, 'layout.revision': input.revision } },
            'processingJob.status': { $nin: ['queued', 'running'] },
            $and: [{ $or: [{ lease: null }, { leaseUntil: { $lte: now } }] }, { $or: [{ inferenceLease: null }, { inferenceLeaseUntil: { $lte: now } }] }],
        },
        {
            $set: {
                'blueprints.$[blueprint].layout': updatedLayout,
                // Preserve concurrent comment writes and keep existing pins at the same location.
                'blueprints.$[blueprint].comments.$[comment].application': 'point',
                'blueprints.$[blueprint].comments.$[comment].x': x,
                'blueprints.$[blueprint].comments.$[comment].y': y,
            },
            $unset: {
                'blueprints.$[blueprint].comments.$[comment].roomId': '',
                'blueprints.$[blueprint].comments.$[comment].fixtureId': '',
            },
        },
        {
            returnDocument: 'after',
            arrayFilters: [
                { 'blueprint.id': input.blueprintId },
                { 'comment.application': 'entity', [input.kind === 'room' ? 'comment.roomId' : 'comment.fixtureId']: input.entityId },
            ],
        },
    ).lean();
    if (!doc) throw new TRPCError({ code: 'CONFLICT', message: 'Drawing is processing or has changed. Refresh and retry.' });
    return db.drawing.DrawingDto(doc);
}
