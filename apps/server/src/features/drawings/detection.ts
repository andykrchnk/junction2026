import { TRPCError } from '@trpc/server';
import { BSON, ObjectId } from 'mongodb';
import { PredictionPageZod } from '@repo/types';
import type { Drawing } from '@repo/types';
import { db } from '../../db';
import { Env } from '../../shared/env';
import { blueprintFiles } from './files';
import { prepareRaster, RasterPreparationError } from './raster';
import { InferenceError, predictRaster } from './inference';
import { storeDrawingCovers, deleteUnreferencedDrawingCovers } from './covers';

type DetectDrawingParams = { id: string; ownerId: string; page: number };

async function readDrawing(params: Pick<DetectDrawingParams, 'id' | 'ownerId'>) {
    const doc = await db.drawing.DrawingModel.findOne({ _id: params.id, ownerId: params.ownerId }).lean();
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found.' });
    return db.drawing.DrawingDto(doc);
}

async function ensureDrawingCovers(params: { drawing: Drawing; ownerId: string }) {
    const { drawing, ownerId } = params;
    if (drawing.covers || drawing.blueprints.some((blueprint) => !blueprint.layout || !blueprint.raster)) return drawing;
    const pages = drawing.blueprints.flatMap((blueprint) => {
        const page = db.drawing.predictionPage(blueprint);
        return page ? [page] : [];
    });
    // Detection is already durable: cover failures must never discard successful geometry.
    const covers = await storeDrawingCovers({ drawingId: drawing.id, ownerId, pages });
    try {
        const saved = await db.drawing.DrawingModel.updateOne({ _id: drawing.id, ownerId, covers: null }, { $set: { covers } });
        if (!saved.matchedCount) await deleteUnreferencedDrawingCovers({ drawingId: drawing.id, ownerId, covers });
    } catch (cause) {
        await deleteUnreferencedDrawingCovers({ drawingId: drawing.id, ownerId, covers });
        throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Room detection is saved, but cover generation failed. Retry detection to create covers.',
            cause,
        });
    }
    return readDrawing({ id: drawing.id, ownerId });
}

export async function detectDrawing(params: DetectDrawingParams) {
    const current = await readDrawing(params);
    if (!current.blueprints.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Upload a blueprint first.' });
    const target = current.blueprints.find((blueprint) => blueprint.pageNumber === params.page);
    if (!target) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid blueprint page.' });
    if (target.layout && target.raster) return ensureDrawingCovers({ drawing: current, ownerId: params.ownerId });

    const availableLease = {
        $and: [
            { $or: [{ inferenceLease: null }, { inferenceLeaseUntil: { $lte: new Date() } }] },
            { $or: [{ lease: null }, { leaseUntil: { $lte: new Date() } }] },
        ],
    };
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
    const blueprint = drawing.blueprints.find((item) => item.pageNumber === params.page);
    if (!blueprint) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid blueprint page.' });
    const ownedBlueprint = { ...ownedLease, 'blueprints.id': blueprint.id };
    try {
        // Another request may have completed this page between the initial read and lease acquisition.
        if (blueprint.layout && blueprint.raster) {
            await db.drawing.DrawingModel.updateOne(ownedLease, { $set: { inferenceLease: null, inferenceLeaseUntil: null } });
            return ensureDrawingCovers({ drawing: await readDrawing(params), ownerId: params.ownerId });
        }
        if (!Env.INFERENCE_BASE_URL || !Env.INFERENCE_API_KEY) {
            await db.drawing.DrawingModel.updateOne(ownedBlueprint, {
                $set: {
                    'blueprints.$.status': { type: 'not_configured', stage: 'inference' },
                    inferenceLease: null,
                    inferenceLeaseUntil: null,
                },
            });
            return readDrawing(params);
        }
        const started = await db.drawing.DrawingModel.updateOne(
            { ...ownedBlueprint, inferenceLeaseUntil: { $gt: new Date() } },
            { $set: { 'blueprints.$.status': { type: 'processing', stage: 'inference' } } },
        );
        if (!started.matchedCount) throw new TRPCError({ code: 'CONFLICT', message: 'Detection expired. Please retry.' });
        const attachment = blueprint.attachment;
        const chunks: Buffer[] = [];
        for await (const chunk of blueprintFiles.openDownloadStream(new ObjectId(attachment.id))) {
            signal.throwIfAborted();
            chunks.push(Buffer.from(chunk));
        }
        const raster = await prepareRaster({ bytes: Buffer.concat(chunks), mediaType: attachment.mediaType, page: attachment.pageNumber, signal });
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
            const layout = db.drawing.layoutFromPrediction(page, prediction.degraded);
            const rasterRecord = { fileId: upload.id.toHexString(), width: raster.width, height: raster.height };
            const updatedBlueprints = drawing.blueprints.map((item) => (item.id === blueprint.id ? { ...item, layout, raster: rasterRecord } : item));
            // Reserve headroom for enrichment, comments and chat within MongoDB's BSON document limit.
            if (BSON.calculateObjectSize({ ...doc, blueprints: updatedBlueprints }) > 12 * 1024 * 1024) {
                throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Detection data is too large for this session.' });
            }
            signal.throwIfAborted();
            const saved = await db.drawing.DrawingModel.updateOne(
                { ...ownedBlueprint, inferenceLeaseUntil: { $gt: new Date() } },
                {
                    $set: {
                        'blueprints.$.layout': layout,
                        'blueprints.$.raster': rasterRecord,
                        'blueprints.$.status': { type: 'uploaded' },
                        inferenceLease: null,
                        inferenceLeaseUntil: null,
                    },
                },
            );
            if (!saved.matchedCount) throw new TRPCError({ code: 'CONFLICT', message: 'Detection expired. Please retry.' });
        } catch (cause) {
            // A write acknowledgement can fail after MongoDB committed the page. Keep a referenced raster.
            const referenced = await db.drawing.DrawingModel.exists({
                _id: params.id,
                ownerId: params.ownerId,
                'blueprints.raster.fileId': upload.id.toHexString(),
            }).catch(() => true);
            if (!referenced) await blueprintFiles.delete(upload.id).catch(() => {});
            throw cause;
        }
    } catch (cause) {
        const message =
            cause instanceof TRPCError || cause instanceof InferenceError || cause instanceof RasterPreparationError
                ? cause.message
                : 'Detection failed or timed out. Please retry.';
        await db.drawing.DrawingModel.updateOne(ownedBlueprint, {
            $set: {
                'blueprints.$.status': { type: 'failed', stage: 'inference', error: message },
                inferenceLease: null,
                inferenceLeaseUntil: null,
            },
        });
        throw new TRPCError({ code: cause instanceof TRPCError ? cause.code : 'INTERNAL_SERVER_ERROR', message, cause });
    }
    return ensureDrawingCovers({ drawing: await readDrawing(params), ownerId: params.ownerId });
}
