import { setTimeout as delay } from 'node:timers/promises';
import { tracked, TRPCError } from '@trpc/server';
import { BSON } from 'mongodb';
import { z } from 'zod';
import {
    AcknowledgeCanvasActionZod,
    CanvasActionAcknowledgmentZod,
    UpdateDrawingUploadZod,
    RenameDrawingZod,
    AskDrawingZod,
    StopDrawingChatZod,
    AdjustDrawingPpmZod,
    StoredPpmResultZod,
    DetectDrawingZod,
    DrawingIdZod,
    ReviewDrawingContextZod,
    DrawingSummaryZod,
    DrawingZod,
    DrawingTraceInputZod,
    MessageZod,
    CanvasStateZod,
    SaveCanvasZod,
    UpdateEntityClassZod,
    DeleteEntityZod,
} from '@repo/types';
import { db } from '../../db';
import { layoutProperties } from '../../db/drawing.schema';
import { protectedProcedure, t } from '../../shared/trpc';
import { answer } from './agent';
import { acknowledgeCanvasAction, createToolTrace } from './tool-trace';
import { processBlueprint } from './blueprint-processing';
import { getDrawing, processDrawing } from './operations';
import { enqueueDrawing } from './processing-jobs';
import { scanCommentsRouter } from './comments';
import { updateEntityClass } from './entity-class';
import { deleteEntity } from './delete-entity';

export const drawingRouter = t.router({
    adjustPpm: protectedProcedure
        .input(AdjustDrawingPpmZod)
        .output(DrawingZod)
        .mutation(async ({ input, ctx }) => {
            const doc = await db.drawing.DrawingModel.findOne({ _id: input.id, ownerId: ctx.user.id }).lean();
            if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
            const drawing = db.drawing.DrawingDto(doc);
            if (drawing.busy) throw new TRPCError({ code: 'CONFLICT', message: 'Wait for processing to finish before adjusting the scale.' });
            const blueprint = drawing.blueprints.find((item) => item.id === input.blueprintId);
            if (!blueprint?.layout || !blueprint.raster)
                throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Room and fixture detection must finish before adjusting the scale.' });
            if (blueprint.layout.revision !== input.layoutRevision)
                throw new TRPCError({ code: 'CONFLICT', message: 'The detected objects changed. Reload the drawing and try again.' });
            const entity = layoutProperties(blueprint.layout).find((item) => item.id === input.entityId);
            const pixelArea = entity?.areaPixels;
            if (!entity || pixelArea === null || pixelArea === undefined || !Number.isFinite(pixelArea) || pixelArea <= 0)
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a detected object with a measurable polygon area.' });
            const value = Math.sqrt(pixelArea / input.areaSquareMetres);
            if (!Number.isFinite(value) || value <= 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Enter an area that produces a valid scale.' });
            const ppm = StoredPpmResultZod.parse({
                value,
                message: `User calibration: ${entity.label} area ${input.areaSquareMetres} m² corresponds to ${Number(pixelArea.toPrecision(6))} px². PPM = √(pixel area ÷ area in m²) ≈ ${Number(value.toPrecision(6))} px/m. Applies to sheet ${blueprint.pageNumber}; the polygon boundary remains an estimate.`,
                calibration: {
                    method: 'area',
                    pixelArea,
                    realAreaSquareMetres: input.areaSquareMetres,
                    usedCandidateIndexes: [],
                    basis: `User-provided area for detected object ${input.entityId}: ${input.areaSquareMetres} m².`,
                    scope: `Sheet ${blueprint.pageNumber}, canonical raster ${blueprint.raster.width} × ${blueprint.raster.height} px. Assumes one scale for this floor-plan view.`,
                },
                userCalibration: { entityId: input.entityId, areaSquareMetres: input.areaSquareMetres, pixelArea, createdAt: new Date().toISOString() },
            });
            const now = new Date();
            const saved = await db.drawing.DrawingModel.updateOne(
                {
                    _id: input.id,
                    ownerId: ctx.user.id,
                    'processingJob.status': { $nin: ['queued', 'running'] },
                    blueprints: { $elemMatch: { id: input.blueprintId, 'layout.revision': input.layoutRevision, 'raster.fileId': blueprint.raster.fileId } },
                    $and: [
                        { $or: [{ lease: null }, { leaseUntil: { $lte: now } }] },
                        { $or: [{ inferenceLease: null }, { inferenceLeaseUntil: { $lte: now } }] },
                    ],
                },
                {
                    $set: { 'blueprints.$.ppm': ppm },
                    $pull: { 'blueprints.$.comments': { source: 'ppm', id: { $regex: '^ppm:door:' }, page: blueprint.pageNumber } },
                },
            );
            if (!saved.matchedCount) throw new TRPCError({ code: 'CONFLICT', message: 'The drawing changed or processing started. Reload and try again.' });
            return getDrawing(input.id, ctx.user.id);
        }),
    acknowledgeCanvasAction: protectedProcedure
        .input(AcknowledgeCanvasActionZod)
        .output(CanvasActionAcknowledgmentZod)
        .mutation(({ input, ctx }) => acknowledgeCanvasAction(input, ctx.user.id)),
    trace: protectedProcedure.input(DrawingTraceInputZod).subscription(async function* ({ input, ctx, signal }) {
        let after = Math.max(input.after, Number(input.lastEventId) || 0);
        const deadline = Date.now() + 160_000;
        while (!signal?.aborted && Date.now() < deadline) {
            // Read only this message; ownership is rechecked on every replay/live read.
            const doc = await db.drawing.DrawingModel.findOne({ _id: input.id, ownerId: ctx.user.id })
                .select({ messages: { $elemMatch: { id: input.messageId } }, lease: 1, leaseUntil: 1 })
                .lean();
            if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
            const message = MessageZod.optional().parse(doc.messages[0]);
            for (const event of message?.trace ?? []) {
                if (event.sequence <= after) continue;
                after = event.sequence;
                yield tracked(String(after), event);
            }
            const active = doc.lease !== null && doc.leaseUntil != null && doc.leaseUntil.getTime() > Date.now();
            if (message && (message.answer || (!active && message.trace?.length))) return;
            await delay(300, undefined, { signal }).catch((cause: unknown) => {
                if (!signal?.aborted) throw cause;
            });
        }
    }),
    reviewContext: protectedProcedure
        .input(ReviewDrawingContextZod)
        .output(DrawingZod)
        .mutation(({ input, ctx }) =>
            processDrawing(input.id, ctx.user.id, async (drawing, signal, lease) => {
                const blueprint = drawing.blueprints.find((item) => item.id === input.blueprintId);
                if (!blueprint || blueprint.status.type !== 'ready')
                    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Finish blueprint analysis before reviewing drawing context.' });
                await processBlueprint({
                    drawing: {
                        ...drawing,
                        blueprints: [
                            {
                                ...blueprint,
                                ...(input.section === 'scale' ? { ppm: null } : { misc: null }),
                                status: { type: 'pending', stage: input.section === 'scale' ? 'ppm' : 'misc' },
                            },
                        ],
                    },
                    ownerId: ctx.user.id,
                    signal,
                    lease,
                    review: input.section,
                });
                return {};
            }),
        ),
    comments: scanCommentsRouter,
    deleteEntity: protectedProcedure
        .input(DeleteEntityZod)
        .output(DrawingZod)
        .mutation(({ input, ctx }) => deleteEntity(input, ctx.user.id)),
    updateEntityClass: protectedProcedure
        .input(UpdateEntityClassZod)
        .output(DrawingZod)
        .mutation(({ input, ctx }) => updateEntityClass(input, ctx.user.id)),
    updateUpload: protectedProcedure
        .input(UpdateDrawingUploadZod)
        .output(DrawingZod)
        .mutation(async ({ input, ctx }) => {
            const doc = await db.drawing.DrawingModel.findOneAndUpdate(
                { _id: input.id, ownerId: ctx.user.id, 'blueprints.pageNumber': input.page ?? 1 },
                {
                    $set: {
                        ...(input.name !== undefined ? { 'blueprints.$[blueprint].attachment.name': input.name } : {}),
                        ...(input.hiddenFromCanvas !== undefined ? { 'blueprints.$[blueprint].attachment.hiddenFromCanvas': input.hiddenFromCanvas } : {}),
                    },
                },
                { new: true, arrayFilters: [{ 'blueprint.pageNumber': input.page ?? 1 }] },
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
        const docs = await db.drawing.DrawingModel.find({ ownerId: ctx.user.id })
            .select('-canvasDocument -canvasRevision -workspaceThumbnail')
            .sort({ updatedAt: -1 })
            .lean();
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
    stop: protectedProcedure
        .input(StopDrawingChatZod)
        .output(DrawingZod)
        .mutation(async ({ input, ctx }) => {
            const doc = await db.drawing.DrawingModel.findOne({ _id: input.id, ownerId: ctx.user.id }).select('lease activeChatMessageId').lean();
            if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
            if (doc.lease && doc.activeChatMessageId === input.messageId) {
                await db.drawing.DrawingModel.updateOne(
                    {
                        _id: input.id,
                        ownerId: ctx.user.id,
                        lease: doc.lease,
                        activeChatMessageId: input.messageId,
                        messages: { $elemMatch: { id: input.messageId, answer: null } },
                    },
                    {
                        $set: {
                            'messages.$.stopped': true,
                            'messages.$.answer': {
                                text: 'Response stopped.',
                                status: 'answered',
                                references: [],
                                clarificationQuestion: null,
                                userProvidedInformation: [],
                            },
                            lease: null,
                            leaseUntil: null,
                            activeChatMessageId: null,
                            error: null,
                        },
                    },
                );
            }
            return getDrawing(input.id, ctx.user.id);
        }),
    ask: protectedProcedure
        .input(AskDrawingZod)
        .output(DrawingZod)
        .mutation(({ input, ctx }) =>
            processDrawing(
                input.id,
                ctx.user.id,
                async (drawing, signal, lease) => {
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
                    const trace = createToolTrace(drawing, ctx.user.id, input.message.id, lease, signal);
                    await trace.emit({ type: 'run_started' });
                    try {
                        const output = await answer(drawing, signal, trace);
                        const messages = drawing.messages.map((message) => (message.id === input.message.id ? { ...message, answer: output } : message));
                        const current = await db.drawing.DrawingModel.findOne({ _id: input.id, ownerId: ctx.user.id, lease }).lean();
                        if (!current) throw new TRPCError({ code: 'CONFLICT', message: 'Processing expired. Please retry.' });
                        // Reserve space for the completion event committed alongside the answer.
                        if (BSON.calculateObjectSize({ ...current, messages }) > 15 * 1024 * 1024 - 1024) {
                            throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'This answer exceeds the session’s supported storage size.' });
                        }
                        await trace.complete();
                        return { messages };
                    } catch (cause) {
                        await trace.emit({
                            type: 'run_failed',
                            summary: signal.aborted ? 'Answer generation was interrupted. Retry to continue.' : 'Could not complete the answer. Please retry.',
                        });
                        throw cause;
                    }
                },
                undefined,
                input.message.id,
            ),
        ),
});
