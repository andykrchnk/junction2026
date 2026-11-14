import { Hono } from 'hono';
import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import { GridFSBucket, ObjectId } from 'mongodb';
import { fileTypeFromBuffer } from 'file-type';
import { PDFDocument } from 'pdf-lib';
import { MAX_FILE_BYTES, MAX_PDF_PAGES, AttachmentZod, DrawingCoversZod, MongoIdZod } from '@repo/types';
import { database } from '../../db/connection';
import { db } from '../../db';
import type { AuthRequestContextVariables } from '../../services/better-auth';

export const blueprintFiles = new GridFSBucket(database, { bucketName: 'blueprints' });
export const drawingFiles = new Hono<{ Variables: AuthRequestContextVariables }>();
drawingFiles.use('*', async (c, next) => {
    if (!c.get('session') || !c.get('user')) return c.json({ message: 'Sign in to continue.' }, 401);
    await next();
});
drawingFiles.use('*', bodyLimit({ maxSize: MAX_FILE_BYTES + 64 * 1024, onError: (c) => c.json({ message: 'File must be 20 MB or smaller.' }, 413) }));
drawingFiles.post('/:id/file', async (c) => {
    const id = MongoIdZod.safeParse(c.req.param('id'));
    const ownerId = c.get('user')?.id;
    if (!id.success) return c.json({ message: 'Drawing not found.' }, 404);
    const doc = await db.drawing.DrawingModel.findOne({ _id: id.data, ownerId }).lean();
    if (!doc) return c.json({ message: 'Drawing not found.' }, 404);
    const existing = db.drawing.DrawingDto(doc).blueprints;
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_FILE_BYTES) return c.json({ message: 'Choose a file between 1 byte and 20 MB.' }, 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    const detected = await fileTypeFromBuffer(bytes);
    const mediaType = AttachmentZod.shape.mediaType.safeParse(detected?.mime);
    if (!mediaType.success) return c.json({ message: 'Choose a JPEG, PNG or PDF.' }, 400);
    let pages = 1;
    if (mediaType.data === 'application/pdf') {
        try {
            pages = (await PDFDocument.load(bytes)).getPageCount();
        } catch {
            return c.json({ message: 'Choose a readable, unencrypted PDF.' }, 400);
        }
        if (pages < 1 || pages > MAX_PDF_PAGES) return c.json({ message: 'PDFs must contain 1–10 pages.' }, 400);
    }
    const name = file.name.replace(/[\r\n\x00-\x1f]/g, '').slice(0, 200) || 'Blueprint';
    const upload = blueprintFiles.openUploadStream(name, { metadata: { ownerId, drawingId: id.data } });
    try {
        await new Promise<void>((resolve, reject) => {
            upload.once('finish', resolve);
            upload.once('error', reject);
            upload.end(bytes);
        });
        const appendedPages = Array.from({ length: pages }, (_, index) => existing.length + index + 1);
        const blueprints = db.drawing
            .createBlueprints({ id: upload.id.toHexString(), name, mediaType: mediaType.data, pages })
            .map((blueprint, index) => ({ ...blueprint, pageNumber: existing.length + index + 1 }));
        // Decide from the current job in the same write as attachment insertion. A worker
        // may finish during upload; never replace an active run or append to a completed one.
        const result = await db.drawing.DrawingModel.updateOne(
            { _id: id.data, ownerId, blueprints: { $size: existing.length } },
            [
                {
                    $set: {
                        ...(!existing.length ? { title: { $literal: name } } : {}),
                        blueprints: { $concatArrays: ['$blueprints', { $literal: blueprints }] },
                        processingJob: {
                            $cond: [
                                { $in: ['$processingJob.status', ['queued', 'running']] },
                                { $mergeObjects: ['$processingJob', { pages: { $concatArrays: ['$processingJob.pages', { $literal: appendedPages }] } }] },
                                { $literal: db.drawing.createProcessingJob(appendedPages) },
                            ],
                        },
                    },
                },
            ],
            { updatePipeline: true },
        );
        if (!result.modifiedCount) {
            await blueprintFiles.delete(upload.id);
            return c.json({ message: 'Another upload changed this drawing. Retry this file.' }, 409);
        }
    } catch (error) {
        const referenced = await db.drawing.DrawingModel.exists({ _id: id.data, ownerId, 'blueprints.attachment.id': upload.id.toHexString() }).catch(
            () => true,
        );
        if (!referenced) await blueprintFiles.delete(upload.id).catch(() => {});
        throw error;
    }
    return c.json({ ok: true });
});
drawingFiles.get('/:id/file', async (c) => {
    const id = MongoIdZod.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ message: 'Drawing not found.' }, 404);
    const doc = await db.drawing.DrawingModel.findOne({ _id: id.data, ownerId: c.get('user')?.id }).lean();
    if (!doc) return c.json({ message: 'Drawing not found.' }, 404);
    const page = z.coerce
        .number()
        .int()
        .positive()
        .safeParse(c.req.query('page') ?? 1);
    if (!page.success) return c.json({ message: 'Invalid blueprint page.' }, 400);
    const attachment = db.drawing.DrawingDto(doc).blueprints.find((blueprint) => blueprint.pageNumber === page.data)?.attachment;
    if (!attachment) return c.json({ message: 'Upload a blueprint first.' }, 404);
    const chunks: Buffer[] = [];
    for await (const chunk of blueprintFiles.openDownloadStream(new ObjectId(attachment.id))) chunks.push(Buffer.from(chunk));
    c.header('Content-Type', attachment.mediaType);
    c.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.name)}`);
    c.header('Cache-Control', 'private, no-store');
    return c.body(Buffer.concat(chunks));
});

// Geometry coordinates refer to this exact oriented/rasterized image, not the source file's raw pixels.
drawingFiles.get('/:id/predictions/:page/image', async (c) => {
    const id = MongoIdZod.safeParse(c.req.param('id'));
    const page = z.coerce.number().int().positive().safeParse(c.req.param('page'));
    if (!id.success || !page.success) return c.json({ message: 'Prediction page not found.' }, 404);
    const doc = await db.drawing.DrawingModel.findOne({ _id: id.data, ownerId: c.get('user')?.id }).lean();
    if (!doc) return c.json({ message: 'Prediction page not found.' }, 404);
    const raster = db.drawing.DrawingDto(doc).blueprints.find((item) => item.pageNumber === page.data)?.raster;
    if (!raster) return c.json({ message: 'Prediction page not found.' }, 404);
    const chunks: Buffer[] = [];
    for await (const chunk of blueprintFiles.openDownloadStream(new ObjectId(raster.fileId))) chunks.push(Buffer.from(chunk));
    c.header('Content-Type', 'image/png');
    c.header('Cache-Control', 'private, no-store');
    return c.body(Buffer.concat(chunks));
});

// Covers are generated during detection; this route only serves stored, owner-scoped images.
drawingFiles.get('/:id/covers/:theme', async (c) => {
    const id = MongoIdZod.safeParse(c.req.param('id'));
    const theme = z.enum(['light', 'dark']).safeParse(c.req.param('theme'));
    if (!id.success || !theme.success) return c.json({ message: 'Drawing cover not found.' }, 404);
    const doc = await db.drawing.DrawingModel.findOne({ _id: id.data, ownerId: c.get('user')?.id })
        .select('covers')
        .lean();
    if (!doc) return c.json({ message: 'Drawing cover not found.' }, 404);
    const covers = DrawingCoversZod.nullable().optional().parse(doc.covers);
    if (!covers) return c.json({ message: 'Drawing cover not found.' }, 404);
    const fileId = theme.data === 'light' ? covers.lightFileId : covers.darkFileId;
    const chunks: Buffer[] = [];
    for await (const chunk of blueprintFiles.openDownloadStream(new ObjectId(fileId))) chunks.push(Buffer.from(chunk));
    c.header('Content-Type', 'image/png');
    c.header('Cache-Control', 'private, no-store');
    return c.body(Buffer.concat(chunks));
});
