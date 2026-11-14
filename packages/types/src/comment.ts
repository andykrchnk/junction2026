import { z } from 'zod';
import { MongoIdZod } from './mongo-id';

const NormalizedCoordinateZod = z.number().min(0).max(1);
const CommentBoundariesZod = z
    .object({
        left: NormalizedCoordinateZod,
        top: NormalizedCoordinateZod,
        right: NormalizedCoordinateZod,
        bottom: NormalizedCoordinateZod,
    })
    .refine((bounds) => bounds.left < bounds.right && bounds.top < bounds.bottom, { message: 'Area boundaries must have positive width and height.' });
const CommentBaseZod = z.object({
    id: z.string().min(1).max(128),
    page: z.number().int().positive(),
    text: z.string().min(1).max(6000),
    source: z.enum(['user', 'ppm']),
    type: z.enum(['annotation', 'comment']),
    createdAt: z.string(),
    number: z.number().int().positive().optional(),
    author: z.object({ id: z.string(), name: z.string() }).optional(),
    deletedAt: z.string().nullable().optional(),
});

export const ScanCommentZod = z.discriminatedUnion('application', [
    CommentBaseZod.extend({ application: z.literal('point'), x: NormalizedCoordinateZod, y: NormalizedCoordinateZod }),
    CommentBaseZod.extend({ application: z.literal('area'), boundaries: CommentBoundariesZod }),
    CommentBaseZod.extend({ application: z.literal('entity'), roomId: z.string().min(1).nullable(), fixtureId: z.string().min(1).nullable() }).refine(
        (comment) => (comment.roomId !== null) !== (comment.fixtureId !== null),
        { message: 'An entity comment must reference exactly one room or fixture.' },
    ),
]);
export const ScanCommentsZod = z.array(ScanCommentZod);
export const CommentListZod = z.object({ drawingId: MongoIdZod });
export const CommentDeleteResultZod = z.object({ id: z.string().min(1).max(128) });
export const CommentDeleteZod = CommentListZod.extend(CommentDeleteResultZod.shape);
export const CommentCreateZod = CommentListZod.extend({
    id: z.string().uuid(),
    page: z.number().int().positive(),
    text: z.string().min(1).max(6000),
    x: NormalizedCoordinateZod,
    y: NormalizedCoordinateZod,
});
export type ScanComment = z.infer<typeof ScanCommentZod>;
export type ScanComments = z.infer<typeof ScanCommentsZod>;
export type CommentCreate = z.infer<typeof CommentCreateZod>;
export type CommentDelete = z.infer<typeof CommentDeleteZod>;
export type CommentDeleteResult = z.infer<typeof CommentDeleteResultZod>;
