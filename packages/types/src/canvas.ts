import { z } from 'zod';
import { DrawingIdZod } from './drawing';

const CanvasFileZod = z.object({
    tldrawFileFormatVersion: z.literal(1),
    schema: z.record(z.string(), z.json()),
    records: z.array(z.record(z.string(), z.json())).max(10000),
});
// Store serialized editor documents, not Mongo subdocuments with editor-defined keys.
export const CanvasDocumentZod = z
    .string()
    .max(4 * 1024 * 1024)
    .refine((value) => {
        try {
            return CanvasFileZod.safeParse(JSON.parse(value)).success;
        } catch {
            return false;
        }
    }, 'Invalid canvas document');
export const CanvasStateZod = z.object({ document: CanvasDocumentZod.nullable(), revision: z.number().int().nonnegative() });
export const SaveCanvasZod = DrawingIdZod.extend({ document: CanvasDocumentZod, revision: z.number().int().nonnegative() });
export type CanvasState = z.infer<typeof CanvasStateZod>;
export type SaveCanvas = z.infer<typeof SaveCanvasZod>;
