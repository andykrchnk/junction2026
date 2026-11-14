import mongoose from 'mongoose';
import { z } from 'zod';
import { StoredAnalysisZod, DetectionZod, AttachmentZod, DrawingZod, MessageZod, PpmCandidatesZod, StoredPpmResultZod, ScanCommentsZod } from '@repo/types';
import { connection } from './connection';

const schema = new mongoose.Schema(
    {
        ownerId: { type: String, required: true },
        title: { type: String, default: 'Untitled drawing' },
        attachment: { type: mongoose.Schema.Types.Mixed, default: null },
        analysis: { type: mongoose.Schema.Types.Mixed, default: null },
        detection: { type: mongoose.Schema.Types.Mixed, default: null },
        ppmCandidates: { type: [mongoose.Schema.Types.Mixed], default: null },
        ppm: { type: mongoose.Schema.Types.Mixed, default: null },
        comments: { type: [mongoose.Schema.Types.Mixed], default: [] },
        inferenceLease: { type: String, default: null },
        inferenceLeaseUntil: { type: Date, default: null },
        messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
        lease: { type: String, default: null },
        leaseUntil: { type: Date, default: null },
        error: { type: String, default: null },
        canvasDocument: { type: String, default: null },
        canvasRevision: { type: Number, default: 0 },
    },
    { timestamps: true, versionKey: false, bufferCommands: false },
);
schema.index({ ownerId: 1, updatedAt: -1 });
type StoredDrawing = mongoose.InferSchemaType<typeof schema>;
export const DrawingModel = connection.modelNames().includes('Drawing')
    ? connection.model<StoredDrawing>('Drawing')
    : connection.model<StoredDrawing>('Drawing', schema, 'drawings');
// Read both legacy geometry discriminators and comments missing classification during migration.
export const StoredScanCommentsZod = z
    .array(z.record(z.string(), z.unknown()))
    .transform((comments) =>
        comments.map((comment) => {
            const legacyApplication = comment.type === 'point' || comment.type === 'area' || comment.type === 'entity';
            return {
                ...comment,
                application: comment.application === undefined && legacyApplication ? comment.type : comment.application,
                type:
                    comment.type === undefined || legacyApplication
                        ? comment.source === 'ppm'
                            ? 'annotation'
                            : comment.source === 'user'
                              ? 'comment'
                              : undefined
                        : comment.type,
            };
        }),
    )
    .pipe(ScanCommentsZod)
    .default([]);
const StoredDrawingZod = z.object({
    _id: z.instanceof(mongoose.Types.ObjectId),
    title: z.string(),
    updatedAt: z.date(),
    createdAt: z.date(),
    attachment: AttachmentZod.nullable(),
    analysis: StoredAnalysisZod.nullable(),
    detection: DetectionZod.nullable().default(null),
    ppmCandidates: PpmCandidatesZod.nullable().default(null),
    ppm: StoredPpmResultZod.nullable().default(null),
    comments: StoredScanCommentsZod,
    inferenceLease: z.string().nullable().default(null),
    inferenceLeaseUntil: z.date().nullable().default(null),
    messages: z.array(MessageZod),
    lease: z.string().nullable(),
    leaseUntil: z.date().nullable(),
    error: z.string().nullable(),
});
export function DrawingDto(data: unknown) {
    const doc = StoredDrawingZod.parse(data);
    const busy = doc.lease !== null && doc.leaseUntil !== null && doc.leaseUntil.getTime() > Date.now();
    const error = !busy && doc.lease ? 'Processing was interrupted. Please retry.' : doc.error;
    const inferenceBusy = doc.inferenceLease !== null && doc.inferenceLeaseUntil !== null && doc.inferenceLeaseUntil.getTime() > Date.now();
    const detection =
        doc.detection?.status === 'processing' && !inferenceBusy
            ? { ...doc.detection, status: doc.detection.pages.length > 0 ? 'partial' : 'failed', error: 'Detection was interrupted. Please retry.' }
            : doc.detection;
    return DrawingZod.parse({
        id: doc._id.toHexString(),
        title: doc.title,
        updatedAt: doc.updatedAt.toISOString(),
        createdAt: doc.createdAt.toISOString(),
        documentCount: doc.attachment ? 1 : 0,
        attachment: doc.attachment,
        analysis: doc.analysis,
        detection,
        ppmCandidates: doc.ppmCandidates,
        ppm: doc.ppm,
        comments: doc.comments.filter((comment) => comment.deletedAt == null),
        messages: doc.messages,
        busy,
        error,
        status: doc.analysis ? 'ready' : !doc.attachment ? 'empty' : busy ? 'analyzing' : error ? 'failed' : 'uploaded',
    });
}
