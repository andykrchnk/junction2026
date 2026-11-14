import { TRPCError } from '@trpc/server';
import { BSON, ObjectId } from 'mongodb';
import { PredictionPageZod } from '@repo/types';
import type { Drawing } from '@repo/types';
import { db } from '../../db';
import { Env } from '../../shared/env';
import { blueprintFiles } from './files';
import { prepareRaster } from './raster';
import { InferenceError, predictRaster } from './inference';

type DetectDrawingParams = { id: string; ownerId: string; page: number };

async function readDrawing(params: Pick<DetectDrawingParams, 'id' | 'ownerId'>) {
    const doc = await db.drawing.DrawingModel.findOne({ _id: params.id, ownerId: params.ownerId }).lean();
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
    return db.drawing.DrawingDto(doc);
}

export async function detectDrawing(params: DetectDrawingParams) {
    const current = await readDrawing(params);
    if (!current.attachment) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Upload a blueprint first.' });
    if (params.page > current.attachment.pages) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid blueprint page.' });
    if (current.detection?.pages.some((page) => page.page === params.page)) return current;

    const availableLease = { $or: [{ inferenceLease: null }, { inferenceLeaseUntil: { $lte: new Date() } }] };
    const lease = crypto.randomUUID();
    const doc = await db.drawing.DrawingModel.findOneAndUpdate(
        { _id: params.id, ownerId: params.ownerId, ...availableLease },
        {
            $set: {
                inferenceLease: lease,
                inferenceLeaseUntil: new Date(Date.now() + Env.INFERENCE_TIMEOUT_MS + 30_000),
            },
        },
        { returnDocument: 'after' },
    ).lean();
    if (!doc) throw new TRPCError({ code: 'CONFLICT', message: 'Detection is already running for this drawing. Wait and retry.' });

    const drawing = db.drawing.DrawingDto(doc);
    const signal = AbortSignal.timeout(Env.INFERENCE_TIMEOUT_MS);
    const ownedLease = { _id: params.id, ownerId: params.ownerId, inferenceLease: lease };
    try {
        // Another request may have completed this page between the initial read and lease acquisition.
        if (drawing.detection?.pages.some((page) => page.page === params.page)) {
            await db.drawing.DrawingModel.updateOne(ownedLease, { $set: { inferenceLease: null, inferenceLeaseUntil: null } });
            return readDrawing(params);
        }
        if (!Env.INFERENCE_BASE_URL || !Env.INFERENCE_API_KEY) {
            await db.drawing.DrawingModel.updateOne(ownedLease, {
                $set: {
                    detection: { status: 'not_configured', pages: drawing.detection?.pages ?? [], error: null },
                    inferenceLease: null,
                    inferenceLeaseUntil: null,
                },
            });
            return readDrawing(params);
        }
        const started = await db.drawing.DrawingModel.updateOne(
            { ...ownedLease, inferenceLeaseUntil: { $gt: new Date() } },
            { $set: { detection: { status: 'processing', pages: drawing.detection?.pages ?? [], error: null } } },
        );
        if (!started.matchedCount) throw new TRPCError({ code: 'CONFLICT', message: 'Detection expired. Please retry.' });
        const attachment = drawing.attachment;
        if (!attachment) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Upload a blueprint first.' });
        const chunks: Buffer[] = [];
        for await (const chunk of blueprintFiles.openDownloadStream(new ObjectId(attachment.id))) {
            signal.throwIfAborted();
            chunks.push(Buffer.from(chunk));
        }
        const raster = await prepareRaster({ bytes: Buffer.concat(chunks), mediaType: attachment.mediaType, page: params.page, signal });
        const prediction = await predictRaster({ raster, signal });
        signal.throwIfAborted();
        const upload = blueprintFiles.openUploadStream(`page-${params.page}.png`, {
            metadata: { ownerId: params.ownerId, drawingId: params.id, page: params.page, purpose: 'inference-raster' },
        });
        try {
            await new Promise<void>((resolve, reject) => {
                upload.once('finish', resolve);
                upload.once('error', reject);
                upload.end(raster.bytes);
            });
            const page = PredictionPageZod.parse({
                page: params.page,
                rasterFileId: upload.id.toHexString(),
                width: raster.width,
                height: raster.height,
                coordinateSystem: 'uploaded_raster_pixels_top_left',
                raw: prediction.raw,
                detectedProperties: prediction.detectedProperties,
                createdAt: new Date().toISOString(),
            });
            const pages = [...(drawing.detection?.pages ?? []), page].sort((a, b) => a.page - b.page);
            const detection: NonNullable<Drawing['detection']> = { status: pages.length === attachment.pages ? 'ready' : 'partial', pages, error: null };
            // Leave room for the analysis, chat history and BSON overhead within MongoDB's document limit.
            if (BSON.calculateObjectSize({ ...doc, detection }) > 12 * 1024 * 1024) {
                throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Detection data is too large for this session.' });
            }
            signal.throwIfAborted();
            const saved = await db.drawing.DrawingModel.updateOne(
                { ...ownedLease, inferenceLeaseUntil: { $gt: new Date() } },
                { $set: { detection, inferenceLease: null, inferenceLeaseUntil: null } },
            );
            if (!saved.matchedCount) throw new TRPCError({ code: 'CONFLICT', message: 'Detection expired. Please retry.' });
        } catch (cause) {
            // A write acknowledgement can fail after MongoDB committed the page. Keep a referenced raster.
            const referenced = await db.drawing.DrawingModel.exists({
                _id: params.id,
                ownerId: params.ownerId,
                'detection.pages.rasterFileId': upload.id.toHexString(),
            }).catch(() => true);
            if (!referenced) await blueprintFiles.delete(upload.id).catch(() => {});
            throw cause;
        }
    } catch (cause) {
        const message = cause instanceof TRPCError || cause instanceof InferenceError ? cause.message : 'Detection failed or timed out. Please retry.';
        await db.drawing.DrawingModel.updateOne(ownedLease, {
            $set: {
                detection: { status: drawing.detection?.pages.length ? 'partial' : 'failed', pages: drawing.detection?.pages ?? [], error: message },
                inferenceLease: null,
                inferenceLeaseUntil: null,
            },
        });
        throw new TRPCError({ code: cause instanceof TRPCError ? cause.code : 'INTERNAL_SERVER_ERROR', message, cause });
    }
    return readDrawing(params);
}
