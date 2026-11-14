import { TRPCError } from '@trpc/server';
import type { Drawing } from '@repo/types';
import { db } from '../../db';
import { Env } from '../../shared/env';

export async function getDrawing(id: string, ownerId: string) {
    const doc = await db.drawing.DrawingModel.findOne({ _id: id, ownerId }).select('-canvasDocument -canvasRevision').lean();
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
    return db.drawing.DrawingDto(doc);
}

export async function processDrawing(
    id: string,
    ownerId: string,
    operation: (drawing: Drawing, signal: AbortSignal, lease: string) => Promise<Partial<Pick<Drawing, 'messages'>>>,
    job?: { lease: string; signal: AbortSignal },
    chatMessageId?: string,
) {
    if (!Env.OPENAI_API_KEY) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Add OPENAI_API_KEY to the server to enable analysis and chat.' });
    const jobFilter = job
        ? { 'processingJob.lease': job.lease, 'processingJob.status': 'running' }
        : { 'processingJob.status': { $nin: ['queued', 'running'] } };
    const lease = crypto.randomUUID();
    const doc = await db.drawing.DrawingModel.findOneAndUpdate(
        {
            _id: id,
            ownerId,
            ...jobFilter,
            $and: [
                { $or: [{ lease: null }, { leaseUntil: { $lte: new Date() } }] },
                { $or: [{ inferenceLease: null }, { inferenceLeaseUntil: { $lte: new Date() } }] },
            ],
        },
        { $set: { lease, leaseUntil: new Date(Date.now() + 150_000), activeChatMessageId: chatMessageId ?? null, error: null } },
        { returnDocument: 'after' },
    ).lean();
    if (!doc) {
        await getDrawing(id, ownerId);
        throw new TRPCError({ code: 'CONFLICT', message: 'This drawing is busy. Wait a moment and retry.' });
    }
    const controller = new AbortController();
    // A stop request may reach another server instance; the persisted lease owns cancellation.
    const poll = chatMessageId
        ? setInterval(() => {
              void db.drawing.DrawingModel.exists({ _id: id, ownerId, lease })
                  .then((owned) => {
                      if (!owned) controller.abort();
                  })
                  .catch(() => controller.abort());
          }, 750)
        : null;
    try {
        const change = await operation(
            db.drawing.DrawingDto(doc),
            AbortSignal.any([AbortSignal.timeout(120_000), controller.signal, ...(job ? [job.signal] : [])]),
            lease,
        );
        const result = await db.drawing.DrawingModel.updateOne(
            { _id: id, ownerId, ...jobFilter, lease, leaseUntil: { $gt: new Date() } },
            { $set: { ...change, lease: null, leaseUntil: null, activeChatMessageId: null, error: null } },
        );
        if (!result.matchedCount) throw new TRPCError({ code: 'CONFLICT', message: 'Processing expired. Please retry.' });
    } catch (cause) {
        if (chatMessageId) {
            const stopped = await db.drawing.DrawingModel.exists({
                _id: id,
                ownerId,
                lease: { $ne: lease },
                messages: { $elemMatch: { id: chatMessageId, stopped: true } },
            });
            if (stopped) return getDrawing(id, ownerId);
        }
        const message = cause instanceof TRPCError ? cause.message : 'Processing failed or timed out. Please retry.';
        await db.drawing.DrawingModel.updateOne(
            { _id: id, ownerId, ...jobFilter, lease },
            { $set: { lease: null, leaseUntil: null, activeChatMessageId: null, error: message } },
        );
        throw new TRPCError({ code: cause instanceof TRPCError ? cause.code : 'INTERNAL_SERVER_ERROR', message, cause });
    } finally {
        if (poll) clearInterval(poll);
    }
    return getDrawing(id, ownerId);
}
