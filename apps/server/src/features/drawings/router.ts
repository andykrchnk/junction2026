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
import type { Drawing } from '@repo/types';
import { db } from '../../db';
import { protectedProcedure, t } from '../../shared/trpc';
import { Env } from '../../shared/env';
import { answer } from './agent';
import { processBlueprint, resetBlueprintPpm } from './blueprint-processing';
import { detectDrawing } from './detection';
import { scanCommentsRouter } from './comments';

export async function getDrawing(id: string, ownerId: string) {
    const doc = await db.drawing.DrawingModel.findOne({ _id: id, ownerId }).select('-canvasDocument -canvasRevision').lean();
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
    return db.drawing.DrawingDto(doc);
}

async function processDrawing(
    id: string,
    ownerId: string,
    operation: (drawing: Drawing, signal: AbortSignal, lease: string) => Promise<Partial<Pick<Drawing, 'messages'>>>,
) {
    if (!Env.OPENAI_API_KEY) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Add OPENAI_API_KEY to the server to enable analysis and chat.' });
    const lease = crypto.randomUUID();
    const doc = await db.drawing.DrawingModel.findOneAndUpdate(
        {
            _id: id,
            ownerId,
            $and: [
                { $or: [{ lease: null }, { leaseUntil: { $lte: new Date() } }] },
                { $or: [{ inferenceLease: null }, { inferenceLeaseUntil: { $lte: new Date() } }] },
            ],
        },
        { $set: { lease, leaseUntil: new Date(Date.now() + 150_000), error: null } },
        { returnDocument: 'after' },
    ).lean();
    if (!doc) {
        await getDrawing(id, ownerId);
        throw new TRPCError({ code: 'CONFLICT', message: 'This drawing is busy. Wait a moment and retry.' });
    }
    try {
        const change = await operation(db.drawing.DrawingDto(doc), AbortSignal.timeout(120_000), lease);
        const result = await db.drawing.DrawingModel.updateOne(
            { _id: id, ownerId, lease, leaseUntil: { $gt: new Date() } },
            { $set: { ...change, lease: null, leaseUntil: null, error: null } },
        );
        if (!result.matchedCount) throw new TRPCError({ code: 'CONFLICT', message: 'Processing expired. Please retry.' });
    } catch (cause) {
        const message = cause instanceof TRPCError ? cause.message : 'Processing failed or timed out. Please retry.';
        await db.drawing.DrawingModel.updateOne({ _id: id, ownerId, lease }, { $set: { lease: null, leaseUntil: null, error: message } });
        throw new TRPCError({ code: cause instanceof TRPCError ? cause.code : 'INTERNAL_SERVER_ERROR', message, cause });
    }
    return getDrawing(id, ownerId);
}

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
        .mutation(({ input, ctx }) => detectDrawing({ id: input.id, ownerId: ctx.user.id, page: input.page })),
    analyze: protectedProcedure
        .input(DrawingIdZod.extend({ retryPpm: z.boolean().optional() }))
        .output(DrawingZod)
        .mutation(({ input, ctx }) =>
            processDrawing(input.id, ctx.user.id, async (drawing, signal, lease) => {
                if (!drawing.blueprints.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Upload a blueprint first.' });
                if (drawing.blueprints.some((blueprint) => !blueprint.layout || !blueprint.raster)) {
                    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Complete inference for every blueprint before starting analysis.' });
                }
                if (input.retryPpm) {
                    for (const blueprint of drawing.blueprints) {
                        await resetBlueprintPpm({ drawingId: drawing.id, ownerId: ctx.user.id, lease, blueprintId: blueprint.id });
                    }
                }
                await processBlueprint({ drawing: input.retryPpm ? await getDrawing(input.id, ctx.user.id) : drawing, signal, lease, ownerId: ctx.user.id });
                return {};
            }),
        ),
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
