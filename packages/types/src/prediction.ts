import { z } from 'zod';
import { MongoIdZod } from './mongo-id';

const PixelPointZod = z.tuple([z.number().finite(), z.number().finite()]);
const PixelBoxZod = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const ScoreZod = z.number().min(0).max(1);
const PolygonCoordinatesZod = z.array(z.array(PixelPointZod).min(4)).min(1);
export const ProcessingGeometryZod = z.discriminatedUnion('type', [
    z.object({ type: z.literal('Polygon'), coordinates: PolygonCoordinatesZod }).strict(),
    z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(PolygonCoordinatesZod).min(1) }).strict(),
]);
const LengthMeasurementZod = z.object({ value: z.number().finite().positive(), unit: z.enum(['mm', 'cm', 'm', 'km', 'ft', 'in']) }).strict();
const AreaMeasurementZod = z.object({ value: z.number().finite().positive(), unit: z.enum(['mm²', 'cm²', 'm²', 'km²', 'ft²', 'in²']) }).strict();
const RoomMeasurementsZod = z
    .object({
        area: AreaMeasurementZod.nullable().default(null),
        length: LengthMeasurementZod.nullable().default(null),
        width: LengthMeasurementZod.nullable().default(null),
        height: LengthMeasurementZod.nullable().default(null),
    })
    .strict();
const FixtureMeasurementsZod = z
    .object({
        width: LengthMeasurementZod.nullable().default(null),
        height: LengthMeasurementZod.nullable().default(null),
    })
    .strict();
export const ProcessingSlabZod = z
    .object({
        id: z.string().min(1),
        class: z.literal('Slab'),
        geometry: ProcessingGeometryZod,
        measurements: z
            .object({
                thickness: z
                    .object({ value: z.number().finite().positive(), unit: z.enum(['mm', 'cm', 'm', 'ft', 'in']).nullable() })
                    .strict()
                    .nullable(),
            })
            .strict(),
        thickness_annotation: z.string().nullable(),
        needs_review: z.literal(true),
    })
    .strict();
export type ProcessingSlab = z.infer<typeof ProcessingSlabZod>;
export const ProcessingPredictionZod = z
    .object({
        coordinate_system: z.literal('image_pixels'),
        slabs: z.array(ProcessingSlabZod).default([]),
        image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
        rooms: z.array(
            z
                .object({
                    id: z.string().min(1),
                    class: z.enum([
                        'Background',
                        'Outdoor',
                        'Wall',
                        'Kitchen',
                        'Living Room',
                        'Bedroom',
                        'Bath',
                        'Hallway',
                        'Railing',
                        'Storage',
                        'Garage',
                        'Undefined',
                        'Sauna',
                        'Balcony',
                    ]),
                    confidence: ScoreZod,
                    name: z.string().nullable().default(null),
                    geometry: ProcessingGeometryZod,
                    measurements: RoomMeasurementsZod.default({ area: null, length: null, width: null, height: null }),
                })
                .strict(),
        ),
        fixtures: z.array(
            z
                .object({
                    id: z.string().min(1),
                    class: z.enum([
                        'No Icon',
                        'Window',
                        'Door',
                        'Closet',
                        'Electrical Appliance',
                        'Toilet',
                        'Sink',
                        'Sauna Bench',
                        'Fire Place',
                        'Bathtub',
                        'Chimney',
                        'Shower Cabin',
                    ]),
                    confidence: ScoreZod,
                    room_ids: z.array(z.string().min(1)),
                    geometry: ProcessingGeometryZod,
                    measurements: FixtureMeasurementsZod.default({ width: null, height: null }),
                })
                .strict(),
        ),
    })
    .strict()
    .superRefine((prediction, ctx) => {
        const objects = [...prediction.rooms, ...prediction.fixtures, ...prediction.slabs];
        if (new Set(objects.map((object) => object.id)).size !== objects.length) {
            ctx.addIssue({ code: 'custom', message: 'Duplicate processing object IDs.' });
        }
        const roomIds = new Set(prediction.rooms.map((room) => room.id));
        if (prediction.fixtures.some((fixture) => fixture.room_ids.some((id) => !roomIds.has(id)))) {
            ctx.addIssue({ code: 'custom', message: 'Unknown fixture room association.' });
        }
        objects.forEach((object) => {
            const polygons = object.geometry.type === 'Polygon' ? [object.geometry.coordinates] : object.geometry.coordinates;
            const invalid = polygons.some((polygon) =>
                polygon.some((ring) => {
                    const first = ring[0];
                    const last = ring.at(-1);
                    return (
                        !first ||
                        !last ||
                        first[0] !== last[0] ||
                        first[1] !== last[1] ||
                        ring.some(([x, y]) => x < 0 || y < 0 || x > prediction.image.width || y > prediction.image.height)
                    );
                }),
            );
            const area = polygons.reduce(
                (total, polygon) =>
                    total +
                    polygon.reduce((subtotal, ring, index) => {
                        const signed = ring.reduce((sum, point, pointIndex) => {
                            const next = ring[(pointIndex + 1) % ring.length];
                            return sum + point[0] * next[1] - next[0] * point[1];
                        }, 0);
                        return subtotal + (index === 0 ? 1 : -1) * Math.abs(signed / 2);
                    }, 0),
                0,
            );
            if (invalid || !Number.isFinite(area) || area <= 0) {
                ctx.addIssue({ code: 'custom', message: 'Invalid processing polygon geometry.' });
            }
        });
    });
export type ProcessingPrediction = z.infer<typeof ProcessingPredictionZod>;
export type ProcessingGeometry = z.infer<typeof ProcessingGeometryZod>;
export const DetectedPropertyZod = z.object({
    id: z.string().min(1),
    type: z.enum(['room', 'icon', 'slab', 'junction']),
    label: z.string(),
    geometry: z.discriminatedUnion('type', [
        z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(PixelPointZod).min(4)).min(1) }),
        z.object({ type: z.literal('Point'), coordinates: PixelPointZod }),
        z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(PolygonCoordinatesZod).min(1) }),
    ]),
    bbox: PixelBoxZod.nullable(),
    centroid: PixelPointZod.nullable(),
    areaPixels: z.number().nonnegative().nullable(),
    confidence: ScoreZod.nullable(),
    scoreMeaning: z.enum(['component_mean_softmax', 'structural_heatmap_peak', 'processing_confidence']).nullable(),
});
export const PredictionPageZod = z.object({
    page: z.number().int().positive(),
    rasterFileId: MongoIdZod,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    coordinateSystem: z.literal('uploaded_raster_pixels_top_left'),
    raw: ProcessingPredictionZod,
    detectedProperties: z.array(DetectedPropertyZod),
    createdAt: z.string(),
});
export const DetectDrawingZod = z.object({ id: MongoIdZod, page: z.number().int().positive() });
export type DetectedProperty = z.infer<typeof DetectedPropertyZod>;
export type PredictionPage = z.infer<typeof PredictionPageZod>;
