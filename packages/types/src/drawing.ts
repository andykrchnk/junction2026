import { z } from 'zod';
import { MongoIdZod } from './mongo-id';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
export const AnalysisZod = z.object({
    summary: z.string(),
    observations: z.array(z.object({ id: z.string(), page: z.number().int().positive(), location: z.string(), fact: z.string(), evidence: z.string() })),
    limitations: z.array(z.string()),
});
export const AnswerZod = z.object({ text: z.string(), sources: z.array(z.string()) });
export const MessageZod = z.object({ id: z.string().uuid(), question: z.string().min(1).max(4000), answer: AnswerZod.nullable() });
export const AttachmentZod = z.object({
    id: MongoIdZod,
    name: z.string(),
    mediaType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
    pages: z.number().int().positive(),
});
export const DrawingSummaryZod = z.object({
    id: MongoIdZod,
    title: z.string(),
    updatedAt: z.string(),
    status: z.enum(['empty', 'uploaded', 'analyzing', 'ready', 'failed']),
});
export const DrawingZod = DrawingSummaryZod.extend({
    attachment: AttachmentZod.nullable(),
    analysis: AnalysisZod.nullable(),
    messages: z.array(MessageZod),
    busy: z.boolean(),
    error: z.string().nullable(),
});
export const DrawingIdZod = z.object({ id: MongoIdZod });
export const AskDrawingZod = DrawingIdZod.extend({ message: MessageZod.omit({ answer: true }) });
export type Drawing = z.infer<typeof DrawingZod>;
export type Analysis = z.infer<typeof AnalysisZod>;
export type Attachment = z.infer<typeof AttachmentZod>;
export type DrawingSummary = z.infer<typeof DrawingSummaryZod>;
export const UploadErrorZod = z.object({ message: z.string() });
