import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
    UpdateDrawingUploadZod,
    RenameDrawingZod,
    AskDrawingZod,
    DetectDrawingZod,
    DrawingIdZod,
    DrawingSummaryZod,
    DrawingZod,
    CanvasStateZod,
    SaveCanvasZod,
} from '@repo/types';
import { db } from '../../db';
import { protectedProcedure, t } from '../../shared/trpc';
import { answer } from './agent';
import { getDrawing, processDrawing } from './operations';
import { enqueueDrawing } from './processing-jobs';
import { scanCommentsRouter } from './comments';

export const drawingRouter = t.router({
    comments: scanCommentsRouter,
    updateUpload: protectedProcedure
        .input(UpdateDrawingUploadZod)
        .output(DrawingZod)
        .mutation(async ({ input, ctx }) => {
            const doc = await db.drawing.DrawingModel.findOneAndUpdate(
                { _id: input.id, ownerId: ctx.user.id, 'blueprints.0': { $exists: true } },
                {
                    $set: {
                        ...(input.name !== undefined ? { 'blueprints.$[].attachment.name': input.name } : {}),
                        ...(input.hiddenFromCanvas !== undefined ? { 'blueprints.$[].attachment.hiddenFromCanvas': input.hiddenFromCanvas } : {}),
                    },
                },
                { new: true },
            ).lean();
            if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Upload not found.' });
            return db.drawing.DrawingDto(doc);
        }),
    rename: protectedProcedure
        .input(RenameDrawingZod)
        .output(DrawingZod)
        .mutation(async ({ input, ctx }) => {
            const doc = await db.drawing.DrawingModel.findOneAndUpdate(
                { _id: input.id, ownerId: ctx.user.id },
                { $set: { title: input.title } },
                { new: true },
            ).lean();
            if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
            return db.drawing.DrawingDto(doc);
        }),
    getCanvas: protectedProcedure
        .input(DrawingIdZod)
        .output(CanvasStateZod)
        .query(async ({ input, ctx }) => {
            const doc = await db.drawing.DrawingModel.findOne({ _id: input.id, ownerId: ctx.user.id }).select('canvasDocument canvasRevision').lean();
            if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
            return CanvasStateZod.parse({ document: doc.canvasDocument ?? null, revision: doc.canvasRevision ?? 0 });
        }),
    saveCanvas: protectedProcedure
        .input(SaveCanvasZod)
        .output(CanvasStateZod)
        .mutation(async ({ input, ctx }) => {
            const doc = await db.drawing.DrawingModel.findOneAndUpdate(
                {
                    _id: input.id,
                    ownerId: ctx.user.id,
                    ...(input.revision === 0 ? { $or: [{ canvasRevision: 0 }, { canvasRevision: { $exists: false } }] } : { canvasRevision: input.revision }),
                },
                { $set: { canvasDocument: input.document }, $inc: { canvasRevision: 1 } },
                { returnDocument: 'after' },
            )
                .select('canvasDocument canvasRevision')
                .lean();
            if (!doc) {
                await getDrawing(input.id, ctx.user.id);
                throw new TRPCError({
                    code: 'CONFLICT',
                    message: 'This canvas was updated in another tab. Your local recovery copy is retained. Reopen the drawing to load the latest version.',
                });
            }
            return CanvasStateZod.parse({ document: doc.canvasDocument, revision: doc.canvasRevision });
        }),
    list: protectedProcedure.output(z.array(DrawingSummaryZod)).query(async ({ ctx }) => {
        const docs = await db.drawing.DrawingModel.find({ ownerId: ctx.user.id }).select('-canvasDocument -canvasRevision').sort({ updatedAt: -1 }).lean();
        return docs.map(db.drawing.DrawingDto);
    }),
    create: protectedProcedure.output(DrawingZod).mutation(async ({ ctx }) => {
        const doc = await db.drawing.DrawingModel.create({ ownerId: ctx.user.id });
        return db.drawing.DrawingDto(doc.toObject());
    }),
    get: protectedProcedure
        .input(DrawingIdZod)
        .output(DrawingZod)
        .query(({ input, ctx }) => getDrawing(input.id, ctx.user.id)),
    detect: protectedProcedure
        .input(DetectDrawingZod)
        .output(DrawingZod)
        .mutation(({ input, ctx }) => enqueueDrawing(input.id, ctx.user.id, input.page)),
    analyze: protectedProcedure
        .input(DrawingIdZod.extend({ retryPpm: z.boolean().optional() }))
        .output(DrawingZod)
        .mutation(({ input, ctx }) => enqueueDrawing(input.id, ctx.user.id, undefined, input.retryPpm)),
    ask: protectedProcedure
        .input(AskDrawingZod)
        .output(DrawingZod)
        .mutation(({ input, ctx }) =>
            processDrawing(input.id, ctx.user.id, async (drawing, signal, lease) => {
                if (!drawing.blueprints.length) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Upload a blueprint first.' });
                const previous = drawing.messages.find((message) => message.id === input.message.id);
                if (previous?.question !== undefined && previous.question !== input.message.question)
                    throw new TRPCError({ code: 'BAD_REQUEST', message: 'This question ID was already used.' });
                if (previous?.answer) return {};
                if (!previous) {
                    if (drawing.messages.some((message) => !message.answer))
                        throw new TRPCError({ code: 'CONFLICT', message: 'Retry the unanswered question first.' });
                    if (drawing.messages.length >= 100)
                        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This PoC supports 100 questions per drawing. Create a new session.' });
                    const message = { ...input.message, answer: null };
                    const saved = await db.drawing.DrawingModel.updateOne(
                        { _id: input.id, ownerId: ctx.user.id, lease, leaseUntil: { $gt: new Date() } },
                        { $push: { messages: message } },
                    );
                    if (!saved.matchedCount) throw new TRPCError({ code: 'CONFLICT', message: 'Processing expired. Please retry.' });
                    drawing.messages.push(message);
                }
                const output = await answer(drawing, signal);
                return { messages: drawing.messages.map((message) => (message.id === input.message.id ? { ...message, answer: output } : message)) };
            }),
        ),
});
