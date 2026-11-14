import { z } from 'zod';
import { ScanCommentZod } from '@repo/types';
import { connection, database } from '../connection';

// Run from the repository root with Bun and --env-file=.env; add --apply after inspecting the dry run.
const apply = Bun.argv.includes('--apply');
const drawings = database.collection<{ comments?: unknown[] }>('drawings');
const legacyApplications = ['point', 'area', 'entity'];
const legacyFilter = { comments: { $elemMatch: { type: { $in: legacyApplications } } } };
const RawCommentZod = z.record(z.string(), z.unknown());

try {
    const affected = await drawings.find(legacyFilter, { projection: { comments: 1 } }).toArray();
    const commentCount = affected.reduce((total, drawing) => {
        return (
            total +
            (drawing.comments ?? []).filter((value) => {
                const comment = RawCommentZod.parse(value);
                if (!legacyApplications.some((application) => application === comment.type)) return false;
                if (Object.hasOwn(comment, 'application') && comment.application !== comment.type) {
                    throw new Error('Conflicting comment type/application values. No migration was applied.');
                }
                const { type: application, ...fields } = comment;
                if (!ScanCommentZod.safeParse({ ...fields, application, type: fields.source === 'ppm' ? 'annotation' : 'comment' }).success) {
                    throw new Error('A legacy comment is invalid. No migration was applied.');
                }
                return true;
            }).length
        );
    }, 0);
    if (!apply) {
        console.log(JSON.stringify({ mode: 'dry-run', scans: affected.length, comments: commentCount }));
    } else {
        const result = await drawings.updateMany(legacyFilter, [
            {
                $set: {
                    comments: {
                        $map: {
                            input: '$comments',
                            as: 'comment',
                            in: {
                                $cond: [
                                    { $not: [{ $in: ['$$comment.type', legacyApplications] }] },
                                    '$$comment',
                                    {
                                        $arrayToObject: {
                                            $concatArrays: [
                                                {
                                                    $filter: {
                                                        input: { $objectToArray: '$$comment' },
                                                        as: 'field',
                                                        cond: { $and: [{ $ne: ['$$field.k', 'type'] }, { $ne: ['$$field.k', 'application'] }] },
                                                    },
                                                },
                                                [{ k: 'application', v: '$$comment.type' }],
                                            ],
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        ]);
        const remaining = await drawings.countDocuments(legacyFilter);
        if (remaining !== 0) throw new Error('Legacy comment fields remain; rerun the migration.');
        console.log(JSON.stringify({ mode: 'apply', scans: result.modifiedCount, comments: commentCount, remainingLegacyScans: remaining }));
    }
} finally {
    await connection.close();
}
