import sharp from 'sharp';
import { ObjectId } from 'mongodb';
import type { DrawingCovers, PredictionPage } from '@repo/types';

const WIDTH = 1200;
const HEIGHT = 800;
const PADDING = 28;
const GAP = 24;
// Mid-tone strokes remain visible against both pure white and pure black.
const PALETTE = ['#d1495b', '#238879', '#8260bc', '#b07b20', '#387ac2', '#b14d90'];
type StoreDrawingCoversParams = Readonly<{ drawingId: string; ownerId: string; pages: PredictionPage[] }>;
type DeleteDrawingCoversParams = Readonly<{ drawingId: string; ownerId: string; covers: DrawingCovers }>;
type UploadCoverParams = Readonly<{ drawingId: string; ownerId: string; theme: 'light' | 'dark'; bytes: Buffer }>;

function color(label: string) {
    const hash = Array.from(label).reduce((value, character) => (Math.imul(value, 31) + character.charCodeAt(0)) >>> 0, 0);
    return PALETTE[hash % PALETTE.length];
}

export async function renderDrawingCovers(pages: PredictionPage[]): Promise<{ light: Buffer; dark: Buffer }> {
    if (pages.length === 0) throw new Error('Cannot render drawing covers without detected pages.');
    const sorted = [...pages].sort((first, second) => first.page - second.page);
    const views = sorted.map((page) => {
        const points = page.detectedProperties
            .filter((property) => property.type === 'room')
            .flatMap((room) => {
                if (room.geometry.type === 'Point') return [];
                return room.geometry.type === 'Polygon' ? room.geometry.coordinates.flat() : room.geometry.coordinates.flat(2);
            });
        if (!points.length) return { page, x: 0, y: 0, width: page.width, height: page.height };
        const bounds = points.reduce<[number, number, number, number]>(
            (value, [x, y]) => [Math.min(value[0], x), Math.min(value[1], y), Math.max(value[2], x), Math.max(value[3], y)],
            [Infinity, Infinity, -Infinity, -Infinity],
        );
        const width = bounds[2] - bounds[0];
        const height = bounds[3] - bounds[1];
        if (width <= 0 || height <= 0) return { page, x: 0, y: 0, width: page.width, height: page.height };
        // Frame the recognized rooms rather than empty scan margins, retaining every outline and hole.
        return { page, x: bounds[0] - width * 0.05, y: bounds[1] - height * 0.05, width: width * 1.1, height: height * 1.1 };
    });
    const layouts = Array.from({ length: views.length }, (_, index) => {
        const columns = index + 1;
        const rows = Math.ceil(sorted.length / columns);
        const width = (WIDTH - PADDING * 2 - GAP * (columns - 1)) / columns;
        const height = (HEIGHT - PADDING * 2 - GAP * (rows - 1)) / rows;
        const area = views.reduce((total, view) => {
            const scale = Math.min(width / view.width, height / view.height);
            return total + view.width * view.height * scale * scale;
        }, 0);
        return { columns, rows, width, height, area };
    });
    const layout = layouts.reduce((best, candidate) => (candidate.area > best.area ? candidate : best));
    const outlines = views
        .map((view, index) => {
            const scale = Math.min(layout.width / view.width, layout.height / view.height);
            const left = PADDING + (index % layout.columns) * (layout.width + GAP) + (layout.width - view.width * scale) / 2;
            const top = PADDING + Math.floor(index / layout.columns) * (layout.height + GAP) + (layout.height - view.height * scale) / 2;
            return view.page.detectedProperties
                .filter((property) => property.type === 'room')
                .flatMap((room) => {
                    if (room.geometry.type === 'Point') return [];
                    const polygons = room.geometry.type === 'Polygon' ? [room.geometry.coordinates] : room.geometry.coordinates;
                    const path = polygons
                        .flatMap((polygon) =>
                            polygon.map(
                                (ring) =>
                                    ring
                                        .map(
                                            ([x, y], pointIndex) =>
                                                `${pointIndex === 0 ? 'M' : 'L'}${left + (x - view.x) * scale} ${top + (y - view.y) * scale}`,
                                        )
                                        .join(' ') + 'Z',
                            ),
                        )
                        .join(' ');
                    return [`<path d="${path}" fill="none" stroke="${color(room.label)}" stroke-width="4" stroke-linejoin="round"/>`];
                })
                .join('');
        })
        .join('');
    const render = (background: string) =>
        sharp(
            Buffer.from(
                `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="${background}"/>${outlines}</svg>`,
            ),
        )
            .png()
            .toBuffer();
    const [light, dark] = await Promise.all([render('#ffffff'), render('#000000')]);
    return { light, dark };
}

async function uploadCover(params: UploadCoverParams) {
    const { blueprintFiles } = await import('./files');
    const stream = blueprintFiles.openUploadStream(`cover-${params.theme}.png`, {
        metadata: { ownerId: params.ownerId, drawingId: params.drawingId, purpose: 'drawing-cover', theme: params.theme },
    });
    try {
        await new Promise<void>((resolve, reject) => {
            stream.once('finish', resolve);
            stream.once('error', reject);
            stream.end(params.bytes);
        });
        return stream.id.toHexString();
    } catch (cause) {
        await blueprintFiles.delete(stream.id).catch(() => {});
        throw cause;
    }
}

export async function storeDrawingCovers(params: StoreDrawingCoversParams): Promise<DrawingCovers> {
    const { blueprintFiles } = await import('./files');
    const images = await renderDrawingCovers(params.pages);
    const lightFileId = await uploadCover({ ...params, theme: 'light', bytes: images.light });
    try {
        const darkFileId = await uploadCover({ ...params, theme: 'dark', bytes: images.dark });
        return { lightFileId, darkFileId };
    } catch (cause) {
        await blueprintFiles.delete(new ObjectId(lightFileId)).catch(() => {});
        throw cause;
    }
}

// Failed acknowledgements may follow a successful reference write. Retain any referenced file.
export async function deleteUnreferencedDrawingCovers(params: DeleteDrawingCoversParams) {
    const [{ db }, { blueprintFiles }] = await Promise.all([import('../../db'), import('./files')]);
    await Promise.all(
        [params.covers.lightFileId, params.covers.darkFileId].map(async (id) => {
            const referenced = await db.drawing.DrawingModel.exists({
                _id: params.drawingId,
                ownerId: params.ownerId,
                $or: [{ 'covers.lightFileId': id }, { 'covers.darkFileId': id }],
            }).catch(() => true);
            if (!referenced) await blueprintFiles.delete(new ObjectId(id)).catch(() => {});
        }),
    );
}
