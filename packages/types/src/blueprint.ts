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
export type BoundingBox = z.infer<typeof BoundingBoxZod>;
export const PpmCandidateZod = z.object({
    type: z.enum(['written_dimension', 'scale_bar', 'printed_scale_ratio', 'known_area', 'known_product', 'calibrated_drawing']),
    page: z.number().int().positive(),
    description: z.string(),
    evidence: z.string(),
    boundingBox: BoundingBoxZod.nullable().describe(
        'Tight box around the printed clue label or scale-bar symbol in full-page normalized coordinates, not the measurement span. Null if unlocatable.',
    ),
    estimatedPpm: z.number().positive().nullable(),
    calculation: z.string().nullable(),
    measurement: z
        .object({
            start: z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }),
            end: z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }),
            realLengthMetres: z.number().finite().positive(),
            unitBasis: z.enum(['explicit', 'convention', 'user']),
            interpretation: z.string().min(1).max(500),
        })
        .nullable()
        .default(null),
});
export const PpmCandidatesZod = z.array(PpmCandidateZod);
export type PpmCandidate = z.infer<typeof PpmCandidateZod>;
export type PpmCandidates = z.infer<typeof PpmCandidatesZod>;
export const AgentPpmResultZod = z.discriminatedUnion('type', [
    z.object({ type: z.literal('success'), value: z.number().finite().positive(), message: z.string() }),
    z.object({ type: z.literal('fail'), message: z.string() }),
]);
const CalibrationSourceZod = z.object({
    usedCandidateIndexes: z.array(z.number().int().nonnegative()).max(50),
    basis: z.string().min(1).max(3000),
    scope: z.string().min(1).max(1000),
});
export const PpmCalibrationZod = z.discriminatedUnion('method', [
    CalibrationSourceZod.extend({ method: z.literal('length'), pixelLength: z.number().finite().positive(), realLengthMetres: z.number().finite().positive() }),
    CalibrationSourceZod.extend({ method: z.literal('area'), pixelArea: z.number().finite().positive(), realAreaSquareMetres: z.number().finite().positive() }),
]);
export const PpmDoorFallbackZod = z.object({
    method: z.enum(['reference', 'default']),
    assumedOpeningWidthMm: z.number().finite().positive(),
    doorId: z.string().min(1),
    page: z.number().int().positive(),
    start: z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }),
    end: z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }),
    pixelLength: z.number().finite().positive(),
    assumptions: z.array(z.string().min(1).max(1000)).max(20),
    sources: z.array(z.object({ url: z.url({ protocol: /^https?$/ }), title: z.string().min(1).max(500), evidence: z.string().min(1).max(2000) })).max(10),
    context: z.object({
        country: z.string().nullable(),
        drawingYear: z.number().int().positive().nullable(),
        buildingType: z.string().nullable(),
        doorType: z.string().nullable(),
    }),
});
export type PpmDoorFallback = z.infer<typeof PpmDoorFallbackZod>;
export const StoredPpmResultZod = z.object({
    value: z.number().finite().positive().optional(),
    message: z.string(),
    // Saved results from before evidence tracking contain only a value and explanation.
    calibration: PpmCalibrationZod.optional(),
    doorFallback: PpmDoorFallbackZod.optional(),
    userCalibration: z
        .object({
            entityId: z.string().min(1),
            areaSquareMetres: z.number().finite().positive(),
            pixelArea: z.number().finite().positive(),
            createdAt: z.iso.datetime(),
        })
        .optional(),
});
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
const EntityFindingZod = z.object({
    objectId: z.string().min(1).nullable().describe('Exact detected entity ID when matched; null for an unmatched visible finding.'),
    description: z.string().min(1).max(500),
    location: z.string().min(1).max(300).describe('Precise location relative to the target and image orientation.'),
    source: z.enum(['observed', 'inferred']),
});
export const EntityFindingsZod = z.object({
    windows: z.array(EntityFindingZod).max(80),
    doors: z
        .array(
            EntityFindingZod.extend({
                connectedRoomIds: z
                    .array(z.string().min(1))
                    .max(12)
                    .nullable()
                    .describe('Other connected room IDs. Null only for confirmed outside access; empty array when the connection is unknown.'),
            }),
        )
        .max(80),
    furniture: z.array(EntityFindingZod).max(100),
    relatedObjects: z
        .array(EntityFindingZod.extend({ relationship: z.enum(['inside', 'adjacent', 'outside', 'overlapping', 'connected', 'unknown']) }))
        .max(100),
    markings: z
        .array(
            z.object({
                kind: z.enum(['text', 'number', 'dimension', 'area', 'arrow', 'symbol', 'other']),
                text: z.string().max(500).nullable().describe('Exact legible transcription, including original units; null when unreadable or non-textual.'),
                description: z.string().min(1).max(500),
                location: z.string().min(1).max(300),
                objectId: z.string().min(1).nullable(),
            }),
        )
        .max(120),
});
export const EntityDescriptionZod = z.object({
    description: z.string().min(1).max(24000),
    name: z.string().min(1).max(200).nullable(),
    interpretedClass: z.string().min(1).max(200).nullable(),
    attributes: z.array(EntityAttributeZod).max(40),
    evidence: z.array(z.string().max(2000)).max(20),
    uncertainties: z.array(z.string().max(2000)).max(20),
    details: EntityFindingsZod.nullable().default(null),
});
const ConciseFindingZod = EntityFindingZod.extend({ description: z.string().min(1).max(160), location: z.string().min(1).max(80) });
export const EntityStructuredDescriptionZod = EntityDescriptionZod.omit({ description: true }).extend({
    name: z.string().min(1).max(60).nullable(),
    interpretedClass: z.string().min(1).max(60).nullable(),
    attributes: z
        .array(EntityAttributeZod.extend({ value: z.union([z.string().max(180), z.number().finite(), z.boolean()]), evidence: z.string().max(180) }))
        .max(8),
    evidence: z.array(z.string().max(180)).max(2),
    uncertainties: z.array(z.string().max(140)).max(2),
    details: EntityFindingsZod.extend({
        windows: z.array(ConciseFindingZod).max(80),
        doors: z.array(ConciseFindingZod.extend({ connectedRoomIds: EntityFindingsZod.shape.doors.element.shape.connectedRoomIds })).max(80),
        furniture: z.array(ConciseFindingZod).max(100),
        relatedObjects: z.array(ConciseFindingZod.extend({ relationship: EntityFindingsZod.shape.relatedObjects.element.shape.relationship })).max(100),
        markings: z
            .array(EntityFindingsZod.shape.markings.element.extend({ description: z.string().min(1).max(120), location: z.string().min(1).max(80) }))
            .max(120),
    }),
});
export const EntityEnrichmentZod = z.discriminatedUnion('type', [
    z.object({ type: z.literal('pending') }),
    z.object({ type: z.literal('processing'), startedAt: z.string(), previousResult: EntityDescriptionZod.nullable().default(null) }),
    z.object({ type: z.literal('complete'), result: EntityDescriptionZod, model: z.string(), promptVersion: z.string(), updatedAt: z.string() }),
    z.object({ type: z.literal('failed'), error: z.string(), previousResult: EntityDescriptionZod.nullable().default(null) }),
]);
export const LayoutRoomZod = ProcessingPredictionZod.shape.rooms.element.extend({ enrichment: EntityEnrichmentZod });
export const LayoutFixtureZod = ProcessingPredictionZod.shape.fixtures.element.omit({ room_ids: true }).extend({
    roomIds: ProcessingPredictionZod.shape.fixtures.element.shape.room_ids,
    enrichment: EntityEnrichmentZod,
});
export const UpdateEntityClassZod = z.discriminatedUnion('kind', [
    z.object({
        id: MongoIdZod,
        blueprintId: z.string().min(1),
        revision: z.string().min(1),
        entityId: z.string().min(1),
        kind: z.literal('room'),
        class: LayoutRoomZod.shape.class,
    }),
    z.object({
        id: MongoIdZod,
        blueprintId: z.string().min(1),
        revision: z.string().min(1),
        entityId: z.string().min(1),
        kind: z.literal('fixture'),
        class: LayoutFixtureZod.shape.class,
    }),
]);
export type UpdateEntityClass = z.infer<typeof UpdateEntityClassZod>;
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
        const entities = new Map([...layout.rooms, ...layout.fixtures].map((entity) => [entity.id, entity]));
        const fixtures = new Set(layout.fixtures.map((fixture) => fixture.id));
        [...layout.rooms, ...layout.fixtures].forEach((entity) => {
            const details = entity.enrichment.type === 'complete' ? entity.enrichment.result.details : null;
            if (!details) return;
            const findings = [...details.windows, ...details.doors, ...details.furniture, ...details.relatedObjects, ...details.markings];
            if (findings.some((finding) => finding.objectId !== null && !entities.has(finding.objectId))) {
                ctx.addIssue({ code: 'custom', message: 'Object findings reference an unknown layout entity.' });
            }
            if (
                details.windows.some(
                    (finding) => finding.objectId !== null && (!fixtures.has(finding.objectId) || entities.get(finding.objectId)?.class !== 'Window'),
                ) ||
                details.doors.some(
                    (finding) => finding.objectId !== null && (!fixtures.has(finding.objectId) || entities.get(finding.objectId)?.class !== 'Door'),
                ) ||
                details.furniture.some((finding) => finding.objectId !== null && !fixtures.has(finding.objectId))
            ) {
                ctx.addIssue({ code: 'custom', message: 'Object findings reference an incompatible entity class.' });
            }
            if (details.doors.some((door) => door.connectedRoomIds?.some((id) => !rooms.has(id) || id === entity.id))) {
                ctx.addIssue({ code: 'custom', message: 'Door findings reference an unknown or identical room.' });
            }
        });
    });
const BlueprintStageZod = z.enum(['inference', 'misc', 'entities', 'ppm']);
export const BlueprintStatusZod = z.discriminatedUnion('type', [
    z.object({ type: z.literal('uploaded') }),
    z.object({ type: z.literal('processing'), stage: BlueprintStageZod }),
    z.object({ type: z.literal('pending'), stage: BlueprintStageZod }),
    z.object({ type: z.literal('partial'), stage: BlueprintStageZod, error: z.string() }),
    z.object({ type: z.literal('failed'), stage: BlueprintStageZod, error: z.string() }),
    z.object({ type: z.literal('rejected'), stage: z.literal('inference'), error: z.string(), code: z.string() }),
    z.object({ type: z.literal('not_configured'), stage: z.literal('inference') }),
    z.object({ type: z.literal('ready') }),
]);
export const DrawingNoteCategoryZod = z.enum(['sheet_details', 'general_notes', 'legend', 'abbreviations', 'dimensions']);
export const DrawingNoteZod = z.object({
    title: z.string().min(1).max(200),
    content: z.string().max(6000),
    // New extraction requires these fields; legacy notes remain readable without them.
    category: DrawingNoteCategoryZod.optional(),
    originalText: z.string().max(6000).nullable().optional(),
    boundingBox: BoundingBoxZod.nullable().optional(),
});
export const BlueprintMiscZod = z.array(DrawingNoteZod).max(100);
export const BlueprintActivityZod = z.object({
    step: z.string().min(1).max(150),
    startedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    status: z.enum(['running', 'completed', 'failed']),
    history: z.array(z.object({ step: z.string().min(1).max(150), startedAt: z.iso.datetime(), finishedAt: z.iso.datetime() })).max(20),
});
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
        processingActivity: BlueprintActivityZod.optional(),
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
export type EntityStructuredDescription = z.infer<typeof EntityStructuredDescriptionZod>;
export type EntityFindings = z.infer<typeof EntityFindingsZod>;
export const ENTITY_ENRICHMENT_PROMPT_VERSION = 'blueprint-entities-v3';
export function hasDetailedEntityDescription(entity: Pick<LayoutRoom | LayoutFixture, 'enrichment'>): boolean {
    return (
        entity.enrichment.type === 'complete' &&
        entity.enrichment.promptVersion === ENTITY_ENRICHMENT_PROMPT_VERSION &&
        entity.enrichment.result.details !== null
    );
}
export function blueprintNeedsAnalysis(blueprint: Blueprint): boolean {
    return (
        blueprint.status.type !== 'ready' ||
        (!!blueprint.layout && [...blueprint.layout.rooms, ...blueprint.layout.fixtures].some((entity) => !hasDetailedEntityDescription(entity)))
    );
}
