import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { RenameDrawingZod, AskDrawingZod, DetectDrawingZod, DrawingIdZod, DrawingSummaryZod, DrawingZod, CanvasStateZod, SaveCanvasZod } from '@repo/types';
import type { Drawing } from '@repo/types';
import { db } from '../../db';
import { protectedProcedure, t } from '../../shared/trpc';
import { Env } from '../../shared/env';
import { blueprintFiles } from './files';
import { analyze, answer } from './agent';
import { detectDrawing } from './detection';
import { estimatePpm } from './ppm-agent';
import { createPpmComments } from './ppm-comments';
import { scanCommentsRouter } from './comments';

export async function getDrawing(id: string, ownerId: string) {
    const doc = await db.drawing.DrawingModel.findOne({ _id: id, ownerId }).select('-canvasDocument -canvasRevision').lean();
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
    return db.drawing.DrawingDto(doc);
}

async function processDrawing(
    id: string,
    ownerId: string,
    operation: (drawing: Drawing, signal: AbortSignal, lease: string) => Promise<Partial<Pick<Drawing, 'analysis' | 'messages' | 'ppmCandidates'>>>,
) {
    if (!Env.OPENAI_API_KEY) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Add OPENAI_API_KEY to the server to enable analysis and chat.' });
    const lease = crypto.randomUUID();
    const doc = await db.drawing.DrawingModel.findOneAndUpdate(
        {
            _id: id,
            ownerId,
            $or: [{ lease: null }, { leaseUntil: { $lte: new Date() } }],
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
        .input(DrawingIdZod)
        .output(DrawingZod)
        .mutation(({ input, ctx }) =>
            processDrawing(input.id, ctx.user.id, async (drawing, signal, lease) => {
                if (drawing.analysis && drawing.ppmCandidates != null) return {};
                if (!drawing.attachment) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Upload a blueprint first.' });
                if (
                    drawing.detection?.status !== 'ready' ||
                    Array.from({ length: drawing.attachment.pages }, (_, index) => index + 1).some(
                        (page) => !drawing.detection?.pages.some((prediction) => prediction.page === page),
                    )
                ) {
                    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Complete NN detection for every page before starting OpenAI analysis.' });
                }
                const attachment = drawing.attachment;
                const detection = drawing.detection;
                const saveResult = async (change: Partial<Pick<Drawing, 'analysis' | 'ppmCandidates'>>) => {
                    signal.throwIfAborted();
                    const saved = await db.drawing.DrawingModel.updateOne(
                        { _id: input.id, ownerId: ctx.user.id, lease, leaseUntil: { $gt: new Date() } },
                        {
                            $set: change,
                            ...(change.ppmCandidates
                                ? {
                                      $push: {
                                          comments: { $each: createPpmComments({ candidates: change.ppmCandidates, createdAt: new Date().toISOString() }) },
                                      },
                                  }
                                : {}),
                        },
                    );
                    if (!saved.matchedCount) throw new TRPCError({ code: 'CONFLICT', message: 'Processing expired. Please retry.' });
                };
                const outcomes = await Promise.allSettled([
                    drawing.analysis
                        ? Promise.resolve()
                        : (async () => {
                              const chunks: Buffer[] = [];
                              for await (const chunk of blueprintFiles.openDownloadStream(new ObjectId(attachment.id))) chunks.push(Buffer.from(chunk));
                              const analysis = await analyze(attachment, Buffer.concat(chunks), signal, detection);
                              await saveResult({ analysis });
                          })(),
                    drawing.ppmCandidates != null
                        ? Promise.resolve()
                        : (async () => {
                              const pages = await Promise.all(
                                  detection.pages.map(async (page) => {
                                      const chunks: Buffer[] = [];
                                      for await (const chunk of blueprintFiles.openDownloadStream(new ObjectId(page.rasterFileId)))
                                          chunks.push(Buffer.from(chunk));
                                      return { page: page.page, width: page.width, height: page.height, bytes: Buffer.concat(chunks) };
                                  }),
                              );
                              const ppmCandidates = await estimatePpm({ pages, detection, signal });
                              await saveResult({ ppmCandidates });
                          })(),
                ]);
                const failure = outcomes.find((outcome) => outcome.status === 'rejected');
                if (failure?.status === 'rejected') {
                    throw new TRPCError({
                        code: 'INTERNAL_SERVER_ERROR',
                        message: 'One or more analysis calls failed or timed out. Saved results are retained; retry to complete the remaining call.',
                        cause: failure.reason,
                    });
                }
                return {};
            }),
        ),
    ask: protectedProcedure
        .input(AskDrawingZod)
        .output(DrawingZod)
        .mutation(({ input, ctx }) =>
            processDrawing(input.id, ctx.user.id, async (drawing, signal, lease) => {
                if (!drawing.analysis) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Analyze the blueprint first.' });
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
