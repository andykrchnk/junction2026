import { z } from 'zod';
import { MongoIdZod } from './mongo-id';
import { BlueprintZod, type AttachmentZod } from './blueprint';
export { BoundingBoxZod, AttachmentZod, PpmCandidatesZod, PpmCandidateZod, AgentPpmResultZod, StoredPpmResultZod } from './blueprint';
export type { PpmCandidate, PpmCandidates, AgentPpmResult, StoredPpmResult } from './blueprint';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
export const AnswerZod = z.object({
    text: z.string(),
    references: z.array(z.object({ blueprintId: z.string(), entityId: z.string().nullable() })).max(50),
    status: z.enum(['answered', 'needs_clarification', 'cannot_determine']),
    clarificationQuestion: z.string().min(1).nullable(),
    userProvidedInformation: z.array(z.string()),
});
export const MessageZod = z.object({ id: z.string().uuid(), question: z.string().min(1).max(4000), answer: AnswerZod.nullable() });
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
export const RenameDrawingZod = DrawingIdZod.extend({ title: z.string().trim().min(1).max(200) });
export const AskDrawingZod = DrawingIdZod.extend({ message: MessageZod.omit({ answer: true }) });
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
