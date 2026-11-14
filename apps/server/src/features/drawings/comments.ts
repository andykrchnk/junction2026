import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
    AttachmentZod,
    CommentCreateZod,
    CommentDeleteZod,
    CommentDeleteResultZod,
    CommentListZod,
    ScanCommentZod,
    ScanCommentsZod,
    type CommentCreate,
    type ScanComment,
} from '@repo/types';
import { db } from '../../db';
import { protectedProcedure, t } from '../../shared/trpc';
import { ensurePpmComments } from './ppm-comments';

const MAX_COMMENTS = 500;
const CommentSnapshotZod = z.object({ attachment: AttachmentZod.nullable(), comments: ScanCommentsZod.default([]) });

async function getSnapshot(params: Readonly<{ drawingId: string; ownerId: string }>) {
    const doc = await db.drawing.DrawingModel.findOne({ _id: params.drawingId, ownerId: params.ownerId }).select('attachment comments').lean();
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
    return CommentSnapshotZod.parse(doc);
}

function existingComment(params: Readonly<{ comments: ScanComment[]; input: CommentCreate }>) {
    const existing = params.comments.find((comment) => comment.id === params.input.id);
    if (
        existing &&
        (existing.deletedAt != null ||
            existing.source !== 'user' ||
            existing.type !== 'point' ||
            existing.page !== params.input.page ||
            existing.text !== params.input.text ||
            existing.x !== params.input.x ||
            existing.y !== params.input.y)
    ) {
        throw new TRPCError({ code: 'CONFLICT', message: 'This comment ID was already used for a different comment.' });
    }
    return existing;
}

export const scanCommentsRouter = t.router({
    list: protectedProcedure
        .input(CommentListZod)
        .output(ScanCommentsZod)
        .query(async ({ input, ctx }) => {
            const params = { drawingId: input.drawingId, ownerId: ctx.user.id };
            await ensurePpmComments(params);
            return (await getSnapshot(params)).comments.filter((comment) => comment.deletedAt == null);
        }),
    delete: protectedProcedure
        .input(CommentDeleteZod)
        .output(CommentDeleteResultZod)
        .mutation(async ({ input, ctx }) => {
            const saved = await db.drawing.DrawingModel.updateOne(
                {
                    _id: input.drawingId,
                    ownerId: ctx.user.id,
                    comments: { $elemMatch: { id: input.id, deletedAt: null } },
                },
                { $set: { 'comments.$.deletedAt': new Date().toISOString() } },
            );
            if (!saved.matchedCount) {
                const snapshot = await getSnapshot({ drawingId: input.drawingId, ownerId: ctx.user.id });
                if (!snapshot.comments.some((comment) => comment.id === input.id)) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found.' });
                }
            }
            return { id: input.id };
        }),
    create: protectedProcedure
        .input(CommentCreateZod)
        .output(ScanCommentZod)
        .mutation(async ({ input, ctx }) => {
            const params = { drawingId: input.drawingId, ownerId: ctx.user.id };
            const snapshot = await getSnapshot(params);
            const existing = existingComment({ comments: snapshot.comments, input });
            if (existing) return existing;
            if (!snapshot.attachment || input.page > snapshot.attachment.pages) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a page in the uploaded blueprint.' });
            }
            const comment = ScanCommentZod.parse({
                id: input.id,
                page: input.page,
                text: input.text,
                source: 'user',
                createdAt: new Date().toISOString(),
                type: 'point',
                x: input.x,
                y: input.y,
            });
            const saved = await db.drawing.DrawingModel.updateOne(
                {
                    _id: input.drawingId,
                    ownerId: ctx.user.id,
                    'attachment.pages': { $gte: input.page },
                    'comments.id': { $ne: input.id },
                    $expr: { $lt: [{ $size: { $ifNull: ['$comments', []] } }, MAX_COMMENTS] },
                },
                { $push: { comments: comment } },
            );
            if (saved.matchedCount) return comment;

            const latest = await getSnapshot(params);
            const duplicate = existingComment({ comments: latest.comments, input });
            if (duplicate) return duplicate;
            if (latest.comments.length >= MAX_COMMENTS) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'This drawing supports up to 500 comments.' });
            }
            throw new TRPCError({ code: 'CONFLICT', message: 'The blueprint changed. Reopen the drawing and retry.' });
        }),
});
