import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
    BlueprintZod,
    CommentCreateZod,
    CommentDeleteZod,
    CommentDeleteResultZod,
    CommentListZod,
    ScanCommentZod,
    ScanCommentsZod,
    type Blueprint,
    type CommentCreate,
    type ScanComment,
} from '@repo/types';
import { db } from '../../db';
import { protectedProcedure, t } from '../../shared/trpc';

const MAX_COMMENTS = 500;
async function getSnapshot(params: Readonly<{ drawingId: string; ownerId: string }>): Promise<{ blueprints: Blueprint[]; comments: ScanComment[] }> {
    const doc = await db.drawing.DrawingModel.findOne({ _id: params.drawingId, ownerId: params.ownerId }).select('blueprints').lean();
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
    const { blueprints } = z.object({ blueprints: z.array(BlueprintZod) }).parse(doc);
    const comments = blueprints.flatMap((blueprint) => blueprint.comments);
    const firstMissingNumber = Math.max(0, ...comments.map((comment) => comment.number ?? 0)) + 1;
    const missing = comments.filter((comment) => comment.number === undefined);
    // Persist numbers once; soft deletion and calibration retries must not renumber user comments.
    for (const [index, comment] of missing.entries()) {
        await db.drawing.DrawingModel.updateOne(
            { _id: params.drawingId, ownerId: params.ownerId },
            { $set: { 'blueprints.$[].comments.$[comment].number': firstMissingNumber + index } },
            { arrayFilters: [{ 'comment.id': comment.id, 'comment.number': { $exists: false } }] },
        );
    }
    if (missing.length) return getSnapshot(params);
    return { blueprints, comments };
}

function existingComment(params: Readonly<{ comments: ScanComment[]; input: CommentCreate }>) {
    const existing = params.comments.find((comment) => comment.id === params.input.id);
    if (
        existing &&
        (existing.deletedAt != null ||
            existing.source !== 'user' ||
            existing.type !== 'comment' ||
            existing.application !== 'point' ||
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
            return (await getSnapshot(params)).comments.filter((comment) => comment.deletedAt == null);
        }),
    delete: protectedProcedure
        .input(CommentDeleteZod)
        .output(CommentDeleteResultZod)
        .mutation(async ({ input, ctx }) => {
            const snapshot = await getSnapshot({ drawingId: input.drawingId, ownerId: ctx.user.id });
            const existing = snapshot.comments.find((comment) => comment.id === input.id);
            if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found.' });
            if (existing.type !== 'comment' || existing.source !== 'user')
                throw new TRPCError({ code: 'FORBIDDEN', message: 'Annotations cannot be deleted.' });
            if (existing.author && existing.author.id !== ctx.user.id)
                throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only delete your own comments.' });
            await db.drawing.DrawingModel.updateOne(
                { _id: input.drawingId, ownerId: ctx.user.id },
                {
                    $set: { 'blueprints.$[].comments.$[comment].deletedAt': existing.deletedAt ?? new Date().toISOString() },
                },
                {
                    arrayFilters: [
                        {
                            'comment.id': input.id,
                            'comment.source': 'user',
                            'comment.type': 'comment',
                            $or: [{ 'comment.author.id': ctx.user.id }, { 'comment.author': { $exists: false } }],
                        },
                    ],
                },
            );
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
            const blueprint = snapshot.blueprints.find((item) => item.pageNumber === input.page);
            if (!blueprint) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a page in the uploaded blueprint.' });
            const comment = ScanCommentZod.parse({
                id: input.id,
                page: input.page,
                text: input.text,
                source: 'user',
                type: 'comment',
                createdAt: new Date().toISOString(),
                number: Math.max(0, ...snapshot.comments.map((item) => item.number ?? 0)) + 1,
                author: { id: ctx.user.id, name: ctx.user.email },
                application: 'point',
                x: input.x,
                y: input.y,
            });
            const saved = await db.drawing.DrawingModel.updateOne(
                {
                    _id: input.drawingId,
                    ownerId: ctx.user.id,
                    'blueprints.id': blueprint.id,
                    'blueprints.comments.id': { $ne: input.id },
                    $expr: {
                        $and: [
                            { $lt: [{ $sum: { $map: { input: '$blueprints', as: 'blueprint', in: { $size: '$$blueprint.comments' } } } }, MAX_COMMENTS] },
                            {
                                $eq: [
                                    { $sum: { $map: { input: '$blueprints', as: 'blueprint', in: { $size: '$$blueprint.comments' } } } },
                                    snapshot.comments.length,
                                ],
                            },
                        ],
                    },
                },
                { $push: { 'blueprints.$.comments': comment } },
            );
            if (saved.matchedCount) return comment;
            const latest = await getSnapshot(params);
            const duplicate = existingComment({ comments: latest.comments, input });
            if (duplicate) return duplicate;
            if (latest.comments.length >= MAX_COMMENTS) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This drawing supports up to 500 comments.' });
            throw new TRPCError({ code: 'CONFLICT', message: 'The blueprint changed. Reopen the drawing and retry.' });
        }),
});
