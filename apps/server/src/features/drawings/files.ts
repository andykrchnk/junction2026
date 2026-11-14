import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { GridFSBucket, ObjectId } from 'mongodb';
import { fileTypeFromBuffer } from 'file-type';
import { PDFDocument } from 'pdf-lib';
import { MAX_FILE_BYTES, MAX_PDF_PAGES, AttachmentZod, MongoIdZod } from '@repo/types';
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
    if (doc.attachment) return c.json({ message: 'Create a new session for another blueprint.' }, 409);
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
        const result = await db.drawing.DrawingModel.updateOne(
            { _id: id.data, ownerId, attachment: null },
            {
                $set: {
                    title: name,
                    attachment: { id: upload.id.toHexString(), name, mediaType: mediaType.data, pages },
                },
            },
        );
        if (!result.modifiedCount) {
            await blueprintFiles.delete(upload.id);
            return c.json({ message: 'A blueprint is already attached.' }, 409);
        }
    } catch (error) {
        await blueprintFiles.delete(upload.id).catch(() => {});
        throw error;
    }
    return c.json({ ok: true });
});
drawingFiles.get('/:id/file', async (c) => {
    const id = MongoIdZod.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ message: 'Drawing not found.' }, 404);
    const doc = await db.drawing.DrawingModel.findOne({ _id: id.data, ownerId: c.get('user')?.id }).lean();
    if (!doc) return c.json({ message: 'Drawing not found.' }, 404);
    const { attachment } = db.drawing.DrawingDto(doc);
    if (!attachment) return c.json({ message: 'Upload a blueprint first.' }, 404);
    const chunks: Buffer[] = [];
    for await (const chunk of blueprintFiles.openDownloadStream(new ObjectId(attachment.id))) chunks.push(Buffer.from(chunk));
    c.header('Content-Type', attachment.mediaType);
    c.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.name)}`);
    c.header('Cache-Control', 'private, no-store');
    return c.body(Buffer.concat(chunks));
});
