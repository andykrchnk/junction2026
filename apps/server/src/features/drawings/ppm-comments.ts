import { ScanCommentZod, ScanCommentsZod, PpmCandidatesZod, type PpmCandidates } from '@repo/types';
import { z } from 'zod';
import { db } from '../../db';

export function createPpmComments(params: Readonly<{ candidates: PpmCandidates; createdAt: string }>) {
    return params.candidates.map((candidate, index) =>
        ScanCommentZod.parse({
            id: `ppm:${candidate.page}:${index}`,
            page: candidate.page,
            type: 'area',
            source: 'ppm',
            createdAt: params.createdAt,
            boundaries: candidate.boundingBox ?? { left: 0, top: 0, right: 1, bottom: 1 },
            text: [
                candidate.description,
                `Evidence: ${candidate.evidence}`,
                candidate.estimatedPpm === null ? 'PPM could not be estimated.' : `Unverified estimate: ${candidate.estimatedPpm} pixels per metre.`,
                candidate.calculation,
                candidate.boundingBox === null ? 'The finding has no precise location; this comment covers the whole sheet.' : null,
            ]
                .filter((text) => text !== null)
                .join('\n\n')
                .slice(0, 6000),
        }),
    );
}

// Materialize findings saved before comments existed, without replacing user comments.
export async function ensurePpmComments(params: Readonly<{ drawingId: string; ownerId: string }>) {
    const doc = await db.drawing.DrawingModel.findOne({ _id: params.drawingId, ownerId: params.ownerId }).select('ppmCandidates comments').lean();
    if (!doc) return;
    const snapshot = z.object({ ppmCandidates: PpmCandidatesZod.nullable().default(null), comments: ScanCommentsZod.default([]) }).parse(doc);
    if (!snapshot.ppmCandidates?.length) return;
    const existing = new Set(snapshot.comments.map((comment) => comment.id));
    const missing = createPpmComments({ candidates: snapshot.ppmCandidates, createdAt: new Date().toISOString() }).filter(
        (comment) => !existing.has(comment.id),
    );
    if (!missing.length) return;
    await db.drawing.DrawingModel.bulkWrite(
        missing.map((comment) => ({
            updateOne: {
                filter: { _id: params.drawingId, ownerId: params.ownerId, 'comments.id': { $ne: comment.id } },
                update: { $push: { comments: comment } },
            },
        })),
    );
}
