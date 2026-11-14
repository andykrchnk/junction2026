import { z } from 'zod';
import { ScanCommentZod } from '@repo/types';
import { connection, database } from '../connection';

// Run with Bun and --env-file=.env; add --apply to convert the existing snapshot.
// Future user-created comments and every other stored field remain unchanged.
const apply = Bun.argv.includes('--apply');
const drawings = database.collection<{ comments?: unknown[] }>('drawings');
const RawCommentZod = z.record(z.string(), z.unknown());

try {
    const documents = await drawings.find({ 'comments.0': { $exists: true } }, { projection: { comments: 1 } }).toArray();
    const targets = documents.flatMap((drawing) => {
        const ids = (drawing.comments ?? []).flatMap((value) => {
            const comment = RawCommentZod.parse(value);
            const parsed = ScanCommentZod.safeParse({ ...comment, type: 'annotation' });
            if (!parsed.success) throw new Error('Invalid stored comment. No conversion was applied.');
            return comment.type === 'annotation' ? [] : [parsed.data.id];
        });
        return ids.length ? [{ id: drawing._id, ids }] : [];
    });
    const commentCount = targets.reduce((total, target) => total + target.ids.length, 0);
    if (!apply) {
        console.log(JSON.stringify({ mode: 'dry-run', scans: targets.length, comments: commentCount }));
    } else {
        if (targets.length) {
            await drawings.bulkWrite(
                targets.map((target) => ({
                    updateOne: {
                        filter: { _id: target.id },
                        update: { $set: { 'comments.$[comment].type': 'annotation' } },
                        arrayFilters: [{ 'comment.id': { $in: target.ids } }],
                    },
                })),
            );
        }
        const converted = await drawings.find({ _id: { $in: targets.map((target) => target.id) } }, { projection: { comments: 1 } }).toArray();
        const remaining = converted.reduce((count, drawing) => {
            const ids = new Set(targets.find((target) => target.id.equals(drawing._id))?.ids ?? []);
            return (
                count +
                (drawing.comments ?? []).filter((value) => {
                    const comment = RawCommentZod.parse(value);
                    return typeof comment.id === 'string' && ids.has(comment.id) && comment.type !== 'annotation';
                }).length
            );
        }, 0);
        if (remaining) throw new Error('Some existing comments were not converted. Rerun the migration.');
        console.log(JSON.stringify({ mode: 'apply', scans: targets.length, comments: commentCount, remaining: 0 }));
    }
} finally {
    await connection.close();
}
