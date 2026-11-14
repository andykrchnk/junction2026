import mongoose from 'mongoose';
import { z } from 'zod';
import {
    BlueprintZod,
    LayoutRoomZod,
    LayoutFixtureZod,
    DetectedPropertyZod,
    DrawingZod,
    DrawingCoversZod,
    MessageZod,
    type LayoutRoom,
    type LayoutFixture,
    type Attachment,
    type Blueprint,
    type BlueprintLayout,
    type PredictionPage,
    type DetectedProperty,
} from '@repo/types';
import { connection } from './connection';

const schema = new mongoose.Schema(
    {
        ownerId: { type: String, required: true },
        title: { type: String, default: 'Untitled drawing' },
        blueprints: { type: [mongoose.Schema.Types.Mixed], default: [] },
        covers: { type: mongoose.Schema.Types.Mixed, default: null },
        inferenceLease: { type: String, default: null },
        inferenceLeaseUntil: { type: Date, default: null },
        messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
        lease: { type: String, default: null },
        leaseUntil: { type: Date, default: null },
        error: { type: String, default: null },
        canvasDocument: { type: String, default: null },
        canvasRevision: { type: Number, default: 0 },
    },
    { timestamps: true, versionKey: false, bufferCommands: false },
);
schema.index({ ownerId: 1, updatedAt: -1 });
type StoredDrawing = mongoose.InferSchemaType<typeof schema>;
export const DrawingModel = connection.modelNames().includes('Drawing')
    ? connection.model<StoredDrawing>('Drawing')
    : connection.model<StoredDrawing>('Drawing', schema, 'drawings');
const StoredDrawingZod = z.object({
    _id: z.instanceof(mongoose.Types.ObjectId),
    title: z.string(),
    updatedAt: z.date(),
    createdAt: z.date(),
    blueprints: z.array(BlueprintZod),
    covers: DrawingCoversZod.nullable(),
    inferenceLease: z.string().nullable(),
    inferenceLeaseUntil: z.date().nullable(),
    messages: z.array(MessageZod),
    lease: z.string().nullable(),
    leaseUntil: z.date().nullable(),
    error: z.string().nullable(),
});
export function DrawingDto(data: unknown) {
    const doc = StoredDrawingZod.parse(data);
    const busy = doc.lease !== null && doc.leaseUntil !== null && doc.leaseUntil.getTime() > Date.now();
    const inferenceBusy = doc.inferenceLease !== null && doc.inferenceLeaseUntil !== null && doc.inferenceLeaseUntil.getTime() > Date.now();
    const error = !busy && doc.lease ? 'Processing was interrupted. Please retry.' : doc.error;
    const blueprints = doc.blueprints.map((blueprint) => {
        if (blueprint.status.type !== 'processing') return blueprint;
        const active = blueprint.status.stage === 'inference' ? inferenceBusy : busy;
        return active
            ? blueprint
            : { ...blueprint, status: { type: 'partial' as const, stage: blueprint.status.stage, error: 'Processing was interrupted. Retry to resume.' } };
    });
    const ready = blueprints.length > 0 && blueprints.every((blueprint) => blueprint.status.type === 'ready');
    const failed = blueprints.some((blueprint) => blueprint.status.type === 'failed' || blueprint.status.type === 'partial');
    return DrawingZod.parse({
        id: doc._id.toHexString(),
        title: doc.title,
        updatedAt: doc.updatedAt.toISOString(),
        createdAt: doc.createdAt.toISOString(),
        documentCount: new Set(blueprints.map((blueprint) => blueprint.attachment.id)).size,
        blueprints: blueprints.map((blueprint) => ({ ...blueprint, comments: blueprint.comments.filter((comment) => comment.deletedAt == null) })),
        covers: doc.covers,
        messages: doc.messages,
        busy: busy || inferenceBusy,
        error,
        status: ready ? 'ready' : !blueprints.length ? 'empty' : busy || inferenceBusy ? 'analyzing' : error || failed ? 'failed' : 'uploaded',
    });
}

export function createBlueprints(attachment: Attachment): Blueprint[] {
    const { pages, ...file } = attachment;
    return Array.from({ length: pages }, (_, index) =>
        BlueprintZod.parse({
            id: `${attachment.id}:${index + 1}`,
            pageNumber: index + 1,
            attachment: { ...file, pageNumber: index + 1 },
            raster: null,
            ppmCandidates: null,
            ppm: null,
            comments: [],
            layout: null,
            misc: null,
            status: { type: 'uploaded' },
        }),
    );
}

export function layoutFromPrediction(page: PredictionPage, degraded: string[] = []): BlueprintLayout {
    return {
        revision: page.rasterFileId,
        summary: '',
        rooms: page.raw.rooms.map((room) => LayoutRoomZod.parse({ ...room, enrichment: { type: 'pending' } })),
        fixtures: page.raw.fixtures.map(({ room_ids, ...fixture }) =>
            LayoutFixtureZod.parse({ ...fixture, roomIds: room_ids, enrichment: { type: 'pending' } }),
        ),
        limitations: degraded.map((stage) => `Inference enrichment was incomplete: ${stage}.`),
        source: { prediction: page.raw, createdAt: page.createdAt, degraded },
    };
}

type GeometryCandidate = Pick<LayoutRoom | LayoutFixture, 'id' | 'class' | 'confidence' | 'geometry'>;
export function layoutProperties(layout: Readonly<{ rooms: readonly GeometryCandidate[]; fixtures: readonly GeometryCandidate[] }>): DetectedProperty[] {
    return [
        ...layout.rooms.map((room) => ({ type: 'room' as const, entity: room })),
        ...layout.fixtures.map((fixture) => ({ type: 'icon' as const, entity: fixture })),
    ].map(({ type, entity }) => {
        const polygons = entity.geometry.type === 'Polygon' ? [entity.geometry.coordinates] : entity.geometry.coordinates;
        const points = polygons.flat(2);
        const bbox = points.reduce<[number, number, number, number]>(
            (bounds, [x, y]) => [Math.min(bounds[0], x), Math.min(bounds[1], y), Math.max(bounds[2], x), Math.max(bounds[3], y)],
            [Infinity, Infinity, -Infinity, -Infinity],
        );
        const areaPixels = polygons.reduce(
            (total, polygon) =>
                total +
                polygon.reduce((subtotal, ring, index) => {
                    const signed = ring.reduce((sum, [x, y], pointIndex) => {
                        const next = ring[(pointIndex + 1) % ring.length];
                        return sum + x * next[1] - next[0] * y;
                    }, 0);
                    return subtotal + (index === 0 ? 1 : -1) * Math.abs(signed / 2);
                }, 0),
            0,
        );
        return DetectedPropertyZod.parse({
            id: entity.id,
            type,
            label: entity.class,
            geometry: entity.geometry,
            bbox,
            centroid: null,
            areaPixels,
            confidence: entity.confidence,
            scoreMeaning: 'processing_confidence',
        });
    });
}

export function predictionPage(blueprint: Blueprint): PredictionPage | null {
    if (!blueprint.layout || !blueprint.raster) return null;
    return {
        page: blueprint.pageNumber,
        rasterFileId: blueprint.raster.fileId,
        width: blueprint.raster.width,
        height: blueprint.raster.height,
        coordinateSystem: 'uploaded_raster_pixels_top_left',
        raw: blueprint.layout.source.prediction,
        detectedProperties: layoutProperties(blueprint.layout),
        createdAt: blueprint.layout.source.createdAt,
    };
}
