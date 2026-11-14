import { z } from 'zod';
import { MongoIdZod } from './mongo-id';
import { ScanCommentsZod } from './comment';
import { ProcessingPredictionZod, PredictionPageZod } from './prediction';

export const BoundingBoxZod = z
    .object({
        left: z.number().min(0).max(1),
        top: z.number().min(0).max(1),
        right: z.number().min(0).max(1),
        bottom: z.number().min(0).max(1),
    })
    .describe('Approximate box in the full displayed page, with top-left origin and coordinates from 0 to 1. Not measurement geometry.');
export const PpmCandidateZod = z.object({
    type: z.enum(['written_dimension', 'scale_bar', 'printed_scale_ratio', 'known_area', 'known_product', 'calibrated_drawing']),
    page: z.number().int().positive(),
    description: z.string(),
    evidence: z.string(),
    boundingBox: BoundingBoxZod.nullable(),
    estimatedPpm: z.number().positive().nullable(),
    calculation: z.string().nullable(),
});
export const PpmCandidatesZod = z.array(PpmCandidateZod);
export type PpmCandidate = z.infer<typeof PpmCandidateZod>;
export type PpmCandidates = z.infer<typeof PpmCandidatesZod>;
export const AgentPpmResultZod = z.discriminatedUnion('type', [
    z.object({ type: z.literal('success'), value: z.number().finite().positive(), message: z.string() }),
    z.object({ type: z.literal('fail'), message: z.string() }),
]);
export const StoredPpmResultZod = z.object({ value: z.number().finite().positive().optional(), message: z.string() });
export type AgentPpmResult = z.infer<typeof AgentPpmResultZod>;
export type StoredPpmResult = z.infer<typeof StoredPpmResultZod>;
export const AttachmentZod = z.object({
    id: MongoIdZod,
    name: z.string(),
    mediaType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
    pages: z.number().int().positive(),
    hiddenFromCanvas: z.boolean().optional(),
});

export const EntityAttributeZod = z.object({
    name: z.string().min(1).max(100),
    value: z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
    unit: z.string().max(100).nullable(),
    evidence: z.string().max(2000),
    source: z.enum(['observed', 'inferred']),
});
export const EntityDescriptionZod = z.object({
    description: z.string().min(1).max(3000),
    name: z.string().min(1).max(200).nullable(),
    interpretedClass: z.string().min(1).max(200).nullable(),
    attributes: z.array(EntityAttributeZod).max(40),
    evidence: z.array(z.string().max(2000)).max(20),
    uncertainties: z.array(z.string().max(2000)).max(20),
});
export const EntityEnrichmentZod = z.discriminatedUnion('type', [
    z.object({ type: z.literal('pending') }),
    z.object({ type: z.literal('complete'), result: EntityDescriptionZod, model: z.string(), promptVersion: z.string(), updatedAt: z.string() }),
    z.object({ type: z.literal('failed'), error: z.string() }),
]);
export const LayoutRoomZod = ProcessingPredictionZod.shape.rooms.element.extend({ enrichment: EntityEnrichmentZod });
export const LayoutFixtureZod = ProcessingPredictionZod.shape.fixtures.element.omit({ room_ids: true }).extend({
    roomIds: ProcessingPredictionZod.shape.fixtures.element.shape.room_ids,
    enrichment: EntityEnrichmentZod,
});
export const BlueprintLayoutZod = z
    .object({
        revision: z.string().min(1),
        summary: z.string(),
        rooms: z.array(LayoutRoomZod),
        fixtures: z.array(LayoutFixtureZod),
        limitations: z.array(z.string()),
        source: z.object({ prediction: PredictionPageZod.shape.raw, createdAt: z.string(), degraded: z.array(z.string()) }),
    })
    .superRefine((layout, ctx) => {
        const ids = [...layout.rooms, ...layout.fixtures].map((entity) => entity.id);
        if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate layout entity IDs.' });
        const rooms = new Set(layout.rooms.map((room) => room.id));
        if (layout.fixtures.some((fixture) => fixture.roomIds.some((id) => !rooms.has(id)))) {
            ctx.addIssue({ code: 'custom', message: 'Unknown layout room association.' });
        }
    });
const BlueprintStageZod = z.enum(['inference', 'misc', 'entities', 'ppm']);
export const BlueprintStatusZod = z.discriminatedUnion('type', [
    z.object({ type: z.literal('uploaded') }),
    z.object({ type: z.literal('processing'), stage: BlueprintStageZod }),
    z.object({ type: z.literal('pending'), stage: BlueprintStageZod }),
    z.object({ type: z.literal('partial'), stage: BlueprintStageZod, error: z.string() }),
    z.object({ type: z.literal('failed'), stage: BlueprintStageZod, error: z.string() }),
    z.object({ type: z.literal('not_configured'), stage: z.literal('inference') }),
    z.object({ type: z.literal('ready') }),
]);
export const BlueprintMiscZod = z.array(z.object({ title: z.string().min(1).max(200), content: z.string().max(6000) })).max(100);
export const BlueprintZod = z
    .object({
        id: z.string().min(1),
        pageNumber: z.number().int().positive(),
        attachment: AttachmentZod.omit({ pages: true }).extend({ pageNumber: z.number().int().positive() }),
        raster: z.object({ fileId: MongoIdZod, width: z.number().int().positive(), height: z.number().int().positive() }).nullable(),
        ppmCandidates: PpmCandidatesZod.nullable(),
        ppm: StoredPpmResultZod.nullable(),
        comments: ScanCommentsZod,
        layout: BlueprintLayoutZod.nullable(),
        misc: BlueprintMiscZod.nullable(),
        status: BlueprintStatusZod,
    })
    .superRefine((blueprint, ctx) => {
        if ((blueprint.layout === null) !== (blueprint.raster === null)) {
            ctx.addIssue({ code: 'custom', message: 'Layout and canonical raster must be stored together.' });
        }
        if (
            blueprint.ppmCandidates?.some((candidate) => candidate.page !== blueprint.pageNumber) ||
            blueprint.comments.some((comment) => comment.page !== blueprint.pageNumber)
        ) {
            ctx.addIssue({ code: 'custom', message: 'Blueprint context references another page.' });
        }
        if (
            blueprint.status.type === 'ready' &&
            (!blueprint.layout ||
                blueprint.misc === null ||
                blueprint.ppmCandidates === null ||
                blueprint.ppm === null ||
                [...blueprint.layout.rooms, ...blueprint.layout.fixtures].some((entity) => entity.enrichment.type !== 'complete'))
        ) {
            ctx.addIssue({ code: 'custom', message: 'Ready blueprint has incomplete context.' });
        }
    });
export type Blueprint = z.infer<typeof BlueprintZod>;
export type BlueprintLayout = z.infer<typeof BlueprintLayoutZod>;
export type BlueprintStatus = z.infer<typeof BlueprintStatusZod>;
export type LayoutRoom = z.infer<typeof LayoutRoomZod>;
export type LayoutFixture = z.infer<typeof LayoutFixtureZod>;
export type EntityDescription = z.infer<typeof EntityDescriptionZod>;
