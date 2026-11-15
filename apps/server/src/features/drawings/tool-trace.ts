import { setTimeout as delay } from 'node:timers/promises';
import { TRPCError } from '@trpc/server';
import {
    DrawingTraceEventZod,
    CanvasActionRequestZod,
    type CanvasVisibilityMode,
    CanvasActionAcknowledgmentZod,
    MessageZod,
    type AcknowledgeCanvasAction,
    type DrawingTraceEvent,
    type Drawing,
    type AnswerReference,
} from '@repo/types';
import { z } from 'zod';
import { db } from '../../db';

type TraceInput = DrawingTraceEvent extends infer Event
    ? Event extends DrawingTraceEvent
        ? Omit<Event, 'id' | 'attemptId' | 'sequence' | 'timestamp'>
        : never
    : never;
type ToolStarted = Extract<TraceInput, { type: 'tool_started' }>;

// A request owns its attempt; MongoDB owns replay. Serialize concurrent tool events to keep sequence order stable.
export function createToolTrace(drawing: Drawing, ownerId: string, messageId: string, lease: string, signal: AbortSignal) {
    const message = drawing.messages.find((item) => item.id === messageId);
    if (!message) throw new Error('Question not found.');
    const events = message.trace ?? [];
    message.trace = events;
    const attemptId = crypto.randomUUID();
    let queue: Promise<unknown> = Promise.resolve();
    const emit = (input: TraceInput) => {
        const write = queue.then(async () => {
            if (events.length >= 2000) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This question has reached its activity history limit.' });
            const event = DrawingTraceEventZod.parse({
                ...input,
                id: crypto.randomUUID(),
                attemptId,
                sequence: (events.at(-1)?.sequence ?? 0) + 1,
                timestamp: new Date().toISOString(),
            });
            const saved = await db.drawing.DrawingModel.updateOne(
                { _id: drawing.id, ownerId, lease, leaseUntil: { $gt: new Date() }, 'messages.id': messageId },
                { $push: { 'messages.$.trace': event } },
            );
            if (!saved.matchedCount) throw new TRPCError({ code: 'CONFLICT', message: 'Processing expired. Please retry.' });
            events.push(event);
            return event;
        });
        queue = write;
        return write;
    };
    const tool = async <T>(details: Omit<ToolStarted, 'type' | 'callId'>, operation: () => Promise<T>, summarize: (result: T) => string) => {
        signal.throwIfAborted();
        const callId = crypto.randomUUID();
        await emit({ type: 'tool_started', callId, ...details });
        let result: T;
        try {
            result = await operation();
            signal.throwIfAborted();
        } catch (cause) {
            await emit({
                type: 'tool_failed',
                callId,
                summary: signal.aborted
                    ? 'Tool execution was interrupted.'
                    : details.toolName === 'highlight_objects'
                      ? 'Could not confirm highlighting in the browser.'
                      : 'Could not complete this action.',
            });
            throw cause;
        }
        await emit({ type: 'tool_completed', callId, summary: summarize(result) });
        return result;
    };
    // Completion is committed atomically with the answer by processDrawing.
    const complete = async () => {
        await queue;
        if (events.length >= 2000) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This question has reached its activity history limit.' });
        events.push(
            DrawingTraceEventZod.parse({
                type: 'run_completed',
                id: crypto.randomUUID(),
                attemptId,
                sequence: (events.at(-1)?.sequence ?? 0) + 1,
                timestamp: new Date().toISOString(),
            }),
        );
    };
    let canvasQueue: Promise<unknown> = Promise.resolve();
    const requestAction = (input: Extract<TraceInput, { type: 'highlight_requested' | 'visibility_requested' }>) => {
        const action = canvasQueue.then(async () => {
            const event = await emit({ ...input, expiresAt: new Date(Date.now() + 20_000).toISOString() });
            const request = CanvasActionRequestZod.parse(event);
            while (Date.now() < Date.parse(request.expiresAt)) {
                signal.throwIfAborted();
                const doc = await db.drawing.DrawingModel.findOne({ _id: drawing.id, ownerId, lease, leaseUntil: { $gt: new Date() } })
                    .select({ messages: { $elemMatch: { id: messageId } } })
                    .lean();
                if (!doc) throw new Error('Drawing processing expired.');
                const stored = z
                    .object({ trace: z.array(DrawingTraceEventZod) })
                    .parse(doc.messages[0])
                    .trace.find((item) => item.id === request.id);
                if (stored && (stored.type === 'highlight_requested' || stored.type === 'visibility_requested') && stored.acknowledgment) {
                    // Keep the browser receipt when the answer and its history are committed together.
                    if (event.type === 'highlight_requested' || event.type === 'visibility_requested') event.acknowledgment = stored.acknowledgment;
                    if (stored.acknowledgment.status === 'failed') throw new Error('The browser could not apply this canvas action.');
                    return { count: request.items.length, focused: request.focus, confirmed: true };
                }
                await delay(250, undefined, { signal });
            }
            throw new Error('The browser did not confirm the canvas action in time.');
        });
        // Keep later actions ordered even if a prior one fails; its caller still receives the failure.
        canvasQueue = action.then(
            () => undefined,
            () => undefined,
        );
        return action;
    };
    const highlight = (items: (AnswerReference & { entityId: string })[], focus: boolean) =>
        requestAction({ type: 'highlight_requested', items, focus, expiresAt: new Date(Date.now() + 20_000).toISOString(), acknowledgment: null });
    const changeVisibility = (items: (AnswerReference & { entityId: string })[], blueprintIds: string[], mode: CanvasVisibilityMode, focus: boolean) =>
        requestAction({
            type: 'visibility_requested',
            items,
            blueprintIds,
            mode,
            focus,
            expiresAt: new Date(Date.now() + 20_000).toISOString(),
            acknowledgment: null,
        });
    return { emit, tool, complete, highlight, changeVisibility };
}
export type ToolTrace = ReturnType<typeof createToolTrace>;

export async function acknowledgeCanvasAction(input: AcknowledgeCanvasAction, ownerId: string) {
    const doc = await db.drawing.DrawingModel.findOne({ _id: input.id, ownerId: ownerId })
        .select({ messages: { $elemMatch: { id: input.messageId } }, lease: 1, leaseUntil: 1 })
        .lean();
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
    const message = MessageZod.optional().parse(doc.messages[0]);
    const request = message?.trace?.find((event) => event.id === input.eventId);
    if (request?.type !== 'highlight_requested' && request?.type !== 'visibility_requested')
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Canvas action not found.' });
    if (request.acknowledgment) return request.acknowledgment;
    const latestAttempt = message?.trace?.filter((event) => event.type === 'run_started').at(-1);
    if (
        latestAttempt?.attemptId !== request.attemptId ||
        message?.trace?.some((event) => event.attemptId === request.attemptId && (event.type === 'run_completed' || event.type === 'run_failed'))
    )
        throw new TRPCError({ code: 'CONFLICT', message: 'This canvas action is no longer active.' });
    if (message?.answer || !doc.lease || !doc.leaseUntil || doc.leaseUntil.getTime() <= Date.now() || Date.parse(request.expiresAt) <= Date.now())
        throw new TRPCError({ code: 'CONFLICT', message: 'This canvas action has expired.' });
    const acknowledgment = CanvasActionAcknowledgmentZod.parse({ status: input.status, completedAt: new Date().toISOString() });
    const saved = await db.drawing.DrawingModel.updateOne(
        { _id: input.id, ownerId: ownerId, lease: doc.lease, leaseUntil: { $gt: new Date() } },
        { $set: { 'messages.$[message].trace.$[event].acknowledgment': acknowledgment } },
        { arrayFilters: [{ 'message.id': input.messageId }, { 'event.id': input.eventId, 'event.acknowledgment': null }] },
    );
    if (!saved.modifiedCount) {
        // A repeated acknowledgment must return the first browser receipt without replacing it.
        const current = await db.drawing.DrawingModel.findOne({ _id: input.id, ownerId: ownerId })
            .select({ messages: { $elemMatch: { id: input.messageId } } })
            .lean();
        const existing = MessageZod.optional()
            .parse(current?.messages[0])
            ?.trace?.find((event) => event.id === input.eventId);
        if (existing && (existing.type === 'highlight_requested' || existing.type === 'visibility_requested') && existing.acknowledgment)
            return existing.acknowledgment;
        throw new TRPCError({ code: 'CONFLICT', message: 'This canvas action is no longer active.' });
    }
    return acknowledgment;
}
