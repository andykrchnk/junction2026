import { z } from 'zod';
import { MongoIdZod } from './mongo-id';
import { DetectionZod } from './prediction';
import { ScanCommentsZod } from './comment';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
export const ContentTypeZod = z.enum([
    'floor_plan',
    'roof_plan',
    'site_plan',
    'elevation',
    'section',
    'detail',
    'schedule',
    'structural_diagram',
    'services_diagram',
    'text',
    'map',
    'perspective',
    'artwork',
    'music',
    'placeholder',
    'other',
    'unknown',
]);
export const ReadabilityZod = z.enum(['clear', 'partial', 'unreadable', 'not_present', 'not_assessed']);
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
export const ClassificationZod = z.object({
    contentTypes: z.array(ContentTypeZod),
    drawingStyle: z.enum(['manual', 'machine_drawn', 'mixed', 'unknown']),
    captureMode: z.enum(['scan', 'photograph', 'digital_export', 'unknown']),
    layout: z.enum(['single_view', 'multiple_views', 'mixed_content', 'fragment', 'unknown']),
    readability: z.object({ text: ReadabilityZod, linework: ReadabilityZod, symbols: ReadabilityZod }),
    issues: z.array(z.enum(['fading', 'blur', 'cropping', 'rotation', 'mirroring', 'distortion', 'overlap', 'obscured', 'low_resolution', 'other'])),
    languages: z.array(z.string()),
    units: z.array(z.string()).describe('Only units actually visible; preserve historic and ambiguous notation.'),
});
export const ViewZod = z.object({
    page: z.number().int().positive(),
    location: z.string(),
    title: z.string().nullable(),
    contentTypes: z.array(ContentTypeZod),
    boundingBox: BoundingBoxZod.nullable(),
    measurementReferences: z.array(
        z.object({
            kind: z.enum(['linear_dimension', 'scale_bar', 'printed_ratio', 'printed_area', 'not_to_scale']),
            text: z.string().describe('Exact readable inscription, not a computed or guessed value.'),
            units: z.string().nullable(),
            location: z.string(),
        }),
    ),
    measurementLimitations: z
        .array(z.string())
        .describe('Missing calibration, uncertain boundaries, perspective, schematic breaks or unknown units for this view.'),
});
export const ObservationZod = z.object({
    page: z.number().int().positive(),
    view: z.string().nullable().describe('Descriptive view location or title; null when it cannot be identified.'),
    location: z.string(),
    kind: z.enum(['room', 'window', 'door', 'fixture', 'dimension', 'area', 'scale', 'title', 'revision', 'text', 'relationship', 'other']),
    label: z.string().nullable(),
    fact: z.string(),
    evidence: z.string(),
    assumptions: z.array(z.string()).describe('Unverified interpretations of this observation, never established drawing facts.'),
    boundingBox: BoundingBoxZod.nullable(),
    recognition: z.enum(['clear', 'uncertain']).describe('Qualitative visual assessment, not a calibrated probability.'),
    visibility: z.enum(['complete', 'partial', 'unknown']),
    constructionState: z.enum(['existing', 'proposed', 'demolished', 'unknown']),
});
export const AnalysisZod = z.object({
    summary: z.string(),
    classification: ClassificationZod.nullable(),
    views: z.array(ViewZod),
    observations: z.array(ObservationZod),
    missingInformation: z.array(z.string()).describe('State the affected task, why information is missing and the smallest useful clarification.'),
    limitations: z
        .array(z.string())
        .describe('Readability, coverage and interpretation limits, including selective inspection and unperformed counting/calibration.'),
});
// Read compatibility only: do not send defaults to the model's strict output schema.
export const StoredAnalysisZod = AnalysisZod.extend({
    classification: AnalysisZod.shape.classification.default(null),
    views: AnalysisZod.shape.views.default([]),
    observations: z.array(
        ObservationZod.extend({
            view: ObservationZod.shape.view.default(null),
            kind: ObservationZod.shape.kind.default('other'),
            label: ObservationZod.shape.label.default(null),
            assumptions: ObservationZod.shape.assumptions.default([]),
            boundingBox: ObservationZod.shape.boundingBox.default(null),
            recognition: ObservationZod.shape.recognition.default('uncertain'),
            visibility: ObservationZod.shape.visibility.default('unknown'),
            constructionState: ObservationZod.shape.constructionState.default('unknown'),
        }),
    ),
    missingInformation: AnalysisZod.shape.missingInformation.default([]),
});
export type Observation = z.infer<typeof ObservationZod>;
export type BoundingBox = z.infer<typeof BoundingBoxZod>;
export const AnswerZod = z.object({
    text: z.string(),
    // Optional on read so existing saved text-only replies remain compatible.
    status: z.enum(['answered', 'needs_clarification', 'cannot_determine']).optional(),
    clarificationQuestion: z.string().min(1).nullable().optional(),
    userProvidedInformation: z.array(z.string()).optional(),
});
// New model responses always include all clarification fields.
export const AgentAnswerZod = AnswerZod.required();
export const MessageZod = z.object({ id: z.string().uuid(), question: z.string().min(1).max(4000), answer: AnswerZod.nullable() });
export const AttachmentZod = z.object({
    id: MongoIdZod,
    name: z.string(),
    mediaType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
    pages: z.number().int().positive(),
    hiddenFromCanvas: z.boolean().optional(),
});
export const DrawingSummaryZod = z.object({
    createdAt: z.string().optional(),
    documentCount: z.number().int().nonnegative().optional(),
    id: MongoIdZod,
    title: z.string(),
    updatedAt: z.string(),
    status: z.enum(['empty', 'uploaded', 'analyzing', 'ready', 'failed']),
});
export const DrawingZod = DrawingSummaryZod.extend({
    attachment: AttachmentZod.nullable(),
    analysis: AnalysisZod.nullable(),
    detection: DetectionZod.nullable().optional(),
    ppmCandidates: PpmCandidatesZod.nullable().optional(),
    ppm: StoredPpmResultZod.nullable().optional(),
    comments: ScanCommentsZod.optional(),
    messages: z.array(MessageZod),
    busy: z.boolean(),
    error: z.string().nullable(),
});
export const DrawingIdZod = z.object({ id: MongoIdZod });
export const RenameDrawingZod = DrawingIdZod.extend({ title: z.string().trim().min(1).max(200) });
export const AskDrawingZod = DrawingIdZod.extend({ message: MessageZod.omit({ answer: true }) });
export type Drawing = z.infer<typeof DrawingZod>;
export type Analysis = z.infer<typeof AnalysisZod>;
export type Attachment = z.infer<typeof AttachmentZod>;
export type DrawingSummary = z.infer<typeof DrawingSummaryZod>;
export const UploadErrorZod = z.object({ message: z.string() });

export const UpdateDrawingUploadZod = DrawingIdZod.extend({ name: z.string().trim().min(1).max(200).optional(), hiddenFromCanvas: z.boolean().optional() });
export type UpdateDrawingUpload = z.infer<typeof UpdateDrawingUploadZod>;
