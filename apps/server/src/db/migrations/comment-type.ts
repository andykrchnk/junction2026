import { z } from 'zod';
import { ScanCommentZod } from '@repo/types';
import { connection, database } from '../connection';

// Dry run: bun --env-file=.env apps/server/src/db/migrations/comment-type.ts
// Apply: append --apply. Existing deletion state and all other comment fields are preserved.
const apply = Bun.argv.includes('--apply');
const drawings = database.collection<{ comments?: unknown[] }>('drawings');
const legacyApplications = ['point', 'area', 'entity'];
const needsClassification = {
    comments: {
        $elemMatch: {
            source: { $in: ['ppm', 'user'] },
            type: { $nin: ['annotation', 'comment'] },
        },
    },
};
const RawCommentZod = z.record(z.string(), z.unknown());

try {
    const documents = await drawings.find({ 'comments.0': { $exists: true } }, { projection: { comments: 1 } }).toArray();
    const totals = documents.reduce(
        (counts, drawing) => {
            const comments = (drawing.comments ?? []).map((value) => {
                const comment = RawCommentZod.parse(value);
                const legacy = legacyApplications.some((application) => application === comment.type);
                if (legacy && comment.application !== undefined && comment.application !== comment.type) {
                    throw new Error('Conflicting legacy application. No migration was applied.');
                }
                const type = comment.type === 'annotation' || comment.type === 'comment' ? comment.type : comment.source === 'ppm' ? 'annotation' : 'comment';
                const application = legacy ? comment.type : comment.application;
                if (!ScanCommentZod.safeParse({ ...comment, application, type }).success) {
                    throw new Error('Invalid stored comment. No migration was applied.');
                }
                return comment.type !== type;
            });
            return {
                scans: counts.scans + (comments.some(Boolean) ? 1 : 0),
                comments: counts.comments + comments.filter(Boolean).length,
            };
        },
        { scans: 0, comments: 0 },
    );
    if (!apply) {
        console.log(JSON.stringify({ mode: 'dry-run', ...totals }));
    } else {
        const result = await drawings.updateMany(needsClassification, [
            {
                $set: {
                    comments: {
                        $map: {
                            input: '$comments',
                            as: 'comment',
                            in: {
                                $cond: [
                                    {
                                        $and: [
                                            { $in: ['$$comment.source', ['ppm', 'user']] },
                                            { $not: [{ $in: ['$$comment.type', ['annotation', 'comment']] }] },
                                        ],
                                    },
                                    {
                                        $mergeObjects: [
                                            '$$comment',
                                            { $cond: [{ $in: ['$$comment.type', legacyApplications] }, { application: '$$comment.type' }, {}] },
                                            { type: { $cond: [{ $eq: ['$$comment.source', 'ppm'] }, 'annotation', 'comment'] } },
                                        ],
                                    },
                                    '$$comment',
                                ],
                            },
                        },
                    },
                },
            },
        ]);
        const remaining = await drawings.countDocuments(needsClassification);
        if (remaining) throw new Error('Some comments still need classification. Rerun the migration.');
        console.log(JSON.stringify({ mode: 'apply', scans: result.modifiedCount, comments: totals.comments, remaining: 0 }));
    }
} finally {
    await connection.close();
}
