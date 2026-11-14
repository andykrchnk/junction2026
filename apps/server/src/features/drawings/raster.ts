import sharp from 'sharp';
import { createCanvas } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const MAX_RASTER_PIXELS = 40_000_000;
const MAX_RASTER_BYTES = 25 * 1024 * 1024;
const PDF_MAX_DIMENSION = 2400;
const RenderResultZod = z.object({ promise: z.custom<Promise<unknown>>((value) => value instanceof Promise) });

export class RasterPreparationError extends Error {}

export type Raster = { bytes: Buffer; width: number; height: number };
type PrepareRasterParams = { bytes: Buffer; mediaType: string; page: number; signal: AbortSignal };

async function renderPdf(params: PrepareRasterParams): Promise<Raster> {
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const moduleUrl = import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    pdf.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const loading = pdf.getDocument({
        data: new Uint8Array(params.bytes),
        useSystemFonts: false,
        standardFontDataUrl: fileURLToPath(new URL('../../standard_fonts/', moduleUrl)),
        cMapUrl: fileURLToPath(new URL('../../cmaps/', moduleUrl)),
        cMapPacked: true,
        wasmUrl: fileURLToPath(new URL('../../wasm/', moduleUrl)),
    });
    const abort = () => {
        void loading.destroy().catch(() => {});
    };
    params.signal.addEventListener('abort', abort, { once: true });
    try {
        params.signal.throwIfAborted();
        const document = await loading.promise;
        if (params.page > document.numPages) throw new Error('PDF page is out of range.');
        const page = await document.getPage(params.page);
        const original = page.getViewport({ scale: 1 });
        const longest = Math.max(original.width, original.height);
        if (!Number.isFinite(longest) || longest <= 0) throw new Error('Invalid PDF page dimensions.');
        const viewport = page.getViewport({ scale: Math.min(2, PDF_MAX_DIMENSION / longest) });
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        const canvas = createCanvas(width, height);
        // PDF.js supports native Node canvases at runtime; its public render types only describe DOM canvases.
        // Validate the returned async operation instead of asserting that a native canvas is an HTML element.
        const rendering: unknown = Reflect.apply(page.render, page, [{ canvas: null, canvasContext: canvas.getContext('2d'), viewport }]);
        await RenderResultZod.parse(rendering).promise;
        params.signal.throwIfAborted();
        return { bytes: await canvas.encode('png'), width, height };
    } finally {
        params.signal.removeEventListener('abort', abort);
        await loading.destroy();
    }
}

export async function prepareRaster(params: PrepareRasterParams): Promise<Raster> {
    params.signal.throwIfAborted();
    if (!Number.isInteger(params.page) || params.page < 1) throw new Error('Invalid prediction page.');
    try {
        const raster =
            params.mediaType === 'application/pdf'
                ? await renderPdf(params)
                : await (async () => {
                      if (params.page !== 1) throw new Error('Images contain only one prediction page.');
                      const { data, info } = await sharp(params.bytes, { limitInputPixels: MAX_RASTER_PIXELS })
                          .rotate()
                          .flatten({ background: '#ffffff' })
                          .resize({ width: PDF_MAX_DIMENSION, height: PDF_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
                          .png()
                          .toBuffer({ resolveWithObject: true });
                      return { bytes: data, width: info.width, height: info.height };
                  })();
        params.signal.throwIfAborted();
        if (raster.width * raster.height > MAX_RASTER_PIXELS || raster.bytes.length > MAX_RASTER_BYTES) {
            throw new Error('Normalized image exceeds inference limits (25 MiB or 40 million pixels).');
        }
        return raster;
    } catch (cause) {
        if (params.signal.aborted) throw new RasterPreparationError('PDF or image preparation was interrupted or timed out. Retry detection.', { cause });
        throw new RasterPreparationError('Could not render this page for detection. Retry detection or upload a PNG or JPG of the page.', { cause });
    }
}
