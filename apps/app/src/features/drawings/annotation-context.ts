import { z } from 'zod';

export const annotationMarker = '\n\nSelected blueprint element (user-selected context, not verified measurements):\n';
export const annotationContextSchema = z.object({
    blueprintId: z.string().min(1).optional(),
    entityId: z.string().min(1).nullable().optional(),
    sheet: z.number().int().positive(),
    label: z.string().min(1).max(200),
    element: z.number().int().positive().nullable(),
    type: z.string(),
    boundsPx: z.array(z.number().finite()).length(4),
    rasterWidth: z.number().positive(),
    rasterHeight: z.number().positive(),
});
