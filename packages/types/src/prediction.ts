import { z } from 'zod';
import { MongoIdZod } from './mongo-id';

const PixelPointZod = z.tuple([z.number().finite(), z.number().finite()]);
const PixelBoxZod = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const ScoreZod = z.number().min(0).max(1);
export const CubiPredictionZod = z.object({
    probability_grid: z.object({
        file: z.string().nullable(),
        shape: z.tuple([z.number().int().positive(), z.number().int().positive()]),
        transform: z.object({
            original_height: z.number().int().positive(),
            original_width: z.number().int().positive(),
            model_height: z.number().int().positive(),
            model_width: z.number().int().positive(),
            content_height: z.number().int().positive(),
            content_width: z.number().int().positive(),
            padding_top: z.number().int().nonnegative(),
            padding_left: z.number().int().nonnegative(),
        }),
        description: z.string(),
    }),
    room_polygons: z.record(
        z.string(),
        z.array(
            z.object({
                geometry_wkt: z.string(),
                area_px: z.number().nonnegative(),
                confidence: ScoreZod,
                bbox: PixelBoxZod,
            }),
        ),
    ),
    icon_detections: z.array(
        z.object({
            class: z.string(),
            centroid_x: z.number().finite(),
            centroid_y: z.number().finite(),
            area_px: z.number().nonnegative(),
            confidence: ScoreZod,
            bbox: PixelBoxZod,
        }),
    ),
    junctions: z.array(z.object({ x: z.number().finite(), y: z.number().finite(), confidence: ScoreZod })),
    device: z.string(),
});
export const DetectedPropertyZod = z.object({
    type: z.enum(['room', 'icon', 'junction']),
    label: z.string(),
    geometry: z.discriminatedUnion('type', [
        z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(PixelPointZod).min(4)).min(1) }),
        z.object({ type: z.literal('Point'), coordinates: PixelPointZod }),
    ]),
    bbox: PixelBoxZod.nullable(),
    centroid: PixelPointZod.nullable(),
    areaPixels: z.number().nonnegative().nullable(),
    confidence: ScoreZod,
    scoreMeaning: z.enum(['component_mean_softmax', 'structural_heatmap_peak']),
});
export const PredictionPageZod = z.object({
    page: z.number().int().positive(),
    rasterFileId: MongoIdZod,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    coordinateSystem: z.literal('uploaded_raster_pixels_top_left'),
    raw: CubiPredictionZod,
    detectedProperties: z.array(DetectedPropertyZod),
    createdAt: z.string(),
});
export const DetectionZod = z.object({
    status: z.enum(['not_configured', 'processing', 'partial', 'ready', 'failed']),
    pages: z.array(PredictionPageZod),
    error: z.string().nullable(),
});
export const DetectDrawingZod = z.object({ id: MongoIdZod, page: z.number().int().positive() });
export type CubiPrediction = z.infer<typeof CubiPredictionZod>;
export type DetectedProperty = z.infer<typeof DetectedPropertyZod>;
export type PredictionPage = z.infer<typeof PredictionPageZod>;
