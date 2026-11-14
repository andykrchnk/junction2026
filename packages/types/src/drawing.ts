import { z } from 'zod';
import { MongoIdZod } from './mongo-id';
import { BlueprintZod, type AttachmentZod } from './blueprint';
export { BoundingBoxZod, AttachmentZod, PpmCandidatesZod, PpmCandidateZod, AgentPpmResultZod, StoredPpmResultZod } from './blueprint';
export type { PpmCandidate, PpmCandidates, AgentPpmResult, StoredPpmResult } from './blueprint';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
export const AnswerReferenceZod = z.object({ blueprintId: z.string(), entityId: z.string().nullable() });
export const EntitySearchZod = z.object({
    blueprintId: z.string().min(1).nullable(),
    kind: z.enum(['room', 'fixture']),
    category: z.string().trim().min(1).max(200).nullable(),
});
const EntityResultReferenceZod = z.object({ type: z.literal('entity_results'), resultId: z.string().uuid() });
export const EntityResultBlockZod = EntityResultReferenceZod.extend({
    title: z.string().min(1),
    query: EntitySearchZod,
    count: z.number().int().nonnegative(),
    items: z.array(AnswerReferenceZod.extend({ entityId: z.string().min(1) })),
})
    .refine((result) => result.count === result.items.length, 'Result count must match its saved objects.')
    .refine(
        (result) => new Set(result.items.map((item) => JSON.stringify([item.blueprintId, item.entityId]))).size === result.items.length,
        'Result objects must be unique.',
    );
const AnswerTextBlockZod = z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(8000) });
const AnswerEntityListBlockZod = z.object({
    type: z.literal('entity_list'),
    title: z.string().trim().min(1).max(200).nullable(),
    items: z
        .array(AnswerReferenceZod.extend({ entityId: z.string().min(1) }))
        .min(1)
        .max(50),
});
const AnswerNoticeBlockZod = z.object({ type: z.literal('notice'), tone: z.enum(['info', 'warning']), text: z.string().trim().min(1).max(2000) });
export const AnswerBlockZod = z.discriminatedUnion('type', [AnswerTextBlockZod, AnswerEntityListBlockZod, AnswerNoticeBlockZod, EntityResultBlockZod]);
export const AnswerPresentationZod = z.object({ version: z.literal(1), blocks: z.array(AnswerBlockZod).min(1).max(20) });
export const AnswerZod = z.object({
    text: z.string(),
    references: z.array(AnswerReferenceZod).max(50),
    status: z.enum(['answered', 'needs_clarification', 'cannot_determine']),
    clarificationQuestion: z.string().min(1).nullable(),
    userProvidedInformation: z.array(z.string()),
    // Older answers have no presentation; unsupported payloads retain their plain-text fallback.
    presentation: AnswerPresentationZod.nullable().optional().catch(null),
});
// Generation requires a supported presentation even though persisted legacy answers do not.
// The model selects request-local results; only the server can supply their objects and counts.
const GeneratedAnswerBlockZod = z.discriminatedUnion('type', [AnswerTextBlockZod, AnswerEntityListBlockZod, AnswerNoticeBlockZod, EntityResultReferenceZod]);
export const StructuredAnswerZod = AnswerZod.extend({
    text: z.string().trim().min(1).max(16000),
    presentation: z.object({ version: z.literal(1), blocks: z.array(GeneratedAnswerBlockZod).min(1).max(20) }),
});
export type EntitySearch = z.infer<typeof EntitySearchZod>;
export type EntityResultBlock = z.infer<typeof EntityResultBlockZod>;
export type Answer = z.infer<typeof AnswerZod>;
export type AnswerBlock = z.infer<typeof AnswerBlockZod>;
export type AnswerReference = z.infer<typeof AnswerReferenceZod>;
export const DrawingToolNameZod = z.enum([
    'get_blueprint_context',
    'list_entities',
    'find_entities',
    'get_entity',
    'list_comments',
    'highlight_objects',
    'hide_objects',
    'show_objects',
    'isolate_objects',
    'show_all_objects',
]);
const TraceEventBaseZod = z.object({
    id: z.string().uuid(),
    attemptId: z.string().uuid(),
    sequence: z.number().int().positive(),
    timestamp: z.string().datetime(),
});
export const HighlightObjectsZod = z.object({
    resultId: z.string().uuid().nullable(),
    items: z.array(AnswerReferenceZod.extend({ entityId: z.string().min(1) })).max(50),
    focus: z.boolean(),
});
export const CanvasActionAcknowledgmentZod = z.object({ status: z.enum(['applied', 'failed']), completedAt: z.string().datetime() });
const CanvasActionFieldsZod = TraceEventBaseZod.extend({
    items: z.array(AnswerReferenceZod.extend({ entityId: z.string().min(1) })).max(5000),
    focus: z.boolean(),
    expiresAt: z.string().datetime(),
    acknowledgment: CanvasActionAcknowledgmentZod.nullable(),
});
export const CanvasHighlightRequestZod = CanvasActionFieldsZod.extend({
    type: z.literal('highlight_requested'),
    items: CanvasActionFieldsZod.shape.items.min(1),
});
export const CanvasVisibilityModeZod = z.enum(['hide', 'show', 'isolate', 'reset']);
export type CanvasVisibilityMode = z.infer<typeof CanvasVisibilityModeZod>;
export const CanvasVisibilityRequestZod = CanvasActionFieldsZod.extend({
    type: z.literal('visibility_requested'),
    mode: CanvasVisibilityModeZod,
    blueprintIds: z.array(z.string().min(1)).min(1).max(100),
}).refine((request) => request.mode === 'reset' || request.items.length > 0, 'Visibility targets are required.');
export const CanvasActionRequestZod = z.discriminatedUnion('type', [CanvasHighlightRequestZod, CanvasVisibilityRequestZod]);
export type CanvasActionRequest = z.infer<typeof CanvasActionRequestZod>;
export type CanvasHighlightRequest = z.infer<typeof CanvasHighlightRequestZod>;
export const AcknowledgeCanvasActionZod = z.object({
    id: MongoIdZod,
    messageId: z.string().uuid(),
    eventId: z.string().uuid(),
    status: z.enum(['applied', 'failed']),
});
export type AcknowledgeCanvasAction = z.infer<typeof AcknowledgeCanvasActionZod>;
export const DrawingTraceEventZod = z.discriminatedUnion('type', [
    CanvasHighlightRequestZod,
    CanvasVisibilityRequestZod,
    TraceEventBaseZod.extend({ type: z.literal('run_started') }),
    TraceEventBaseZod.extend({ type: z.literal('run_completed') }),
    TraceEventBaseZod.extend({ type: z.literal('run_failed'), summary: z.string().max(500) }),
    TraceEventBaseZod.extend({
        type: z.literal('tool_started'),
        callId: z.string().uuid(),
        toolName: DrawingToolNameZod,
        title: z.string().max(300),
        blueprintId: z.string().nullable(),
        entityId: z.string().nullable(),
        category: z.string().nullable(),
    }),
    TraceEventBaseZod.extend({ type: z.literal('tool_completed'), callId: z.string().uuid(), summary: z.string().max(500) }),
    TraceEventBaseZod.extend({ type: z.literal('tool_failed'), callId: z.string().uuid(), summary: z.string().max(500) }),
]);
export type DrawingTraceEvent = z.infer<typeof DrawingTraceEventZod>;
export const DrawingTraceInputZod = z.object({
    id: MongoIdZod,
    messageId: z.string().uuid(),
    after: z.number().int().nonnegative().default(0),
    lastEventId: z.string().nullish(),
});
export const MessageZod = z.object({
    id: z.string().uuid(),
    question: z.string().min(1).max(4000),
    answer: AnswerZod.nullable(),
    trace: z.array(DrawingTraceEventZod).max(2000).optional(),
    stopped: z.boolean().optional(),
});
export const DrawingCoversZod = z.object({ lightFileId: MongoIdZod, darkFileId: MongoIdZod });
export type DrawingCovers = z.infer<typeof DrawingCoversZod>;
export const DrawingSummaryZod = z.object({
    covers: DrawingCoversZod.nullable().optional(),
    createdAt: z.string().optional(),
    documentCount: z.number().int().nonnegative().optional(),
    id: MongoIdZod,
    title: z.string(),
    updatedAt: z.string(),
    status: z.enum(['empty', 'uploaded', 'analyzing', 'ready', 'failed']),
});
export const DrawingJobProgressZod = z.object({
    status: z.enum(['queued', 'running', 'completed']),
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    currentPage: z.number().int().positive().nullable(),
});
export const DrawingZod = DrawingSummaryZod.extend({
    processing: DrawingJobProgressZod.nullable().optional(),
    blueprints: z.array(BlueprintZod),
    messages: z.array(MessageZod),
    busy: z.boolean(),
    error: z.string().nullable(),
});
export const DrawingIdZod = z.object({ id: MongoIdZod });
export const ReviewDrawingContextZod = DrawingIdZod.extend({ blueprintId: z.string().min(1), section: z.enum(['scale', 'notes']) });
export type ReviewDrawingContext = z.infer<typeof ReviewDrawingContextZod>;
export const RenameDrawingZod = DrawingIdZod.extend({ title: z.string().trim().min(1).max(200) });
export const AskDrawingZod = DrawingIdZod.extend({ message: MessageZod.omit({ answer: true, trace: true, stopped: true }) });
export const StopDrawingChatZod = DrawingIdZod.extend({ messageId: z.string().uuid() });
export type Drawing = z.infer<typeof DrawingZod>;
export type Attachment = z.infer<typeof AttachmentZod>;
export type DrawingSummary = z.infer<typeof DrawingSummaryZod>;
export const UploadErrorZod = z.object({ message: z.string() });

export const UpdateDrawingUploadZod = DrawingIdZod.extend({
    page: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    hiddenFromCanvas: z.boolean().optional(),
});
export type UpdateDrawingUpload = z.infer<typeof UpdateDrawingUploadZod>;
