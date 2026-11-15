import { z } from 'zod';
import type { Drawing } from '@repo/types';

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
export type AnnotationContext = z.infer<typeof annotationContextSchema>;
export const ObjectAnnotationContextSchema = annotationContextSchema.extend({
    blueprintId: z.string().min(1),
    entityId: z.string().min(1),
});
export type ObjectAnnotationContext = z.infer<typeof ObjectAnnotationContextSchema>;

export function objectAnnotationContext({
    drawing,
    blueprintId,
    entityId,
}: Readonly<{ drawing: Drawing; blueprintId: string; entityId: string }>): ObjectAnnotationContext | null {
    const blueprint = drawing.blueprints.find((item) => item.id === blueprintId && !item.attachment.hiddenFromCanvas);
    if (!blueprint?.layout || !blueprint.raster) return null;
    const { width, height } = blueprint.raster;
    if (![width, height].every((value) => Number.isFinite(value) && value > 0)) return null;
    // The canonical object order is rooms followed by fixtures, as in layoutProperties.
    const objects = [...blueprint.layout.rooms, ...blueprint.layout.fixtures];
    const index = objects.findIndex((item) => item.id === entityId);
    const object = objects[index];
    if (!object) return null;
    const points = object.geometry.type === 'Polygon' ? object.geometry.coordinates.flat() : object.geometry.coordinates.flat(2);
    if (!points.length || points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width || y > height)) return null;
    const context = ObjectAnnotationContextSchema.safeParse({
        blueprintId,
        entityId,
        sheet: blueprint.pageNumber,
        label: object.class,
        element: index + 1,
        type: index < blueprint.layout.rooms.length ? 'room' : 'icon',
        boundsPx: [
            Math.min(...points.map(([x]) => x)),
            Math.min(...points.map(([, y]) => y)),
            Math.max(...points.map(([x]) => x)),
            Math.max(...points.map(([, y]) => y)),
        ].map(Math.round),
        rasterWidth: width,
        rasterHeight: height,
    });
    return context.success ? context.data : null;
}
