import { setTimeout as delay } from 'node:timers/promises';
import { CubiPredictionZod, DetectedPropertyZod } from '@repo/types';
import type { CubiPrediction, DetectedProperty } from '@repo/types';
import { Env } from '../../shared/env';
import type { Raster } from './raster';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BUSY_RETRIES = 2;
type PixelPoint = [number, number];
type PixelBox = [number, number, number, number];
type PredictRasterParams = { raster: Raster; signal: AbortSignal };

function polygonCoordinates(wkt: string): PixelPoint[][] {
    const polygon = /^POLYGON\s*\(\s*(\([\s\S]+\))\s*\)$/i.exec(wkt.trim());
    if (!polygon) throw new Error('The inference response contains an unsupported room polygon.');
    return polygon[1].split(/\)\s*,\s*\(/).map((ring) => {
        const coordinates = ring
            .replace(/^\s*\(/, '')
            .replace(/\)\s*$/, '')
            .split(',')
            .map((point): PixelPoint => {
                const values = point.trim().split(/\s+/).map(Number);
                if (values.length !== 2 || !values.every(Number.isFinite)) throw new Error('Invalid inference polygon coordinates.');
                return [values[0], values[1]];
            });
        const first = coordinates[0];
        const last = coordinates.at(-1);
        if (coordinates.length < 4 || !first || !last || first[0] !== last[0] || first[1] !== last[1]) {
            throw new Error('The inference response contains an unclosed room polygon.');
        }
        return coordinates;
    });
}

function rectangle(box: PixelBox): PixelPoint[][] {
    const [left, top, right, bottom] = box;
    if (left >= right || top >= bottom) throw new Error('The inference response contains an invalid bounding box.');
    return [
        [
            [left, top],
            [right, top],
            [right, bottom],
            [left, bottom],
            [left, top],
        ],
    ];
}

function properties(raw: CubiPrediction): DetectedProperty[] {
    const rooms = Object.entries(raw.room_polygons).flatMap(([label, polygons]) =>
        polygons.map((polygon) => {
            rectangle(polygon.bbox);
            return DetectedPropertyZod.parse({
                type: 'room',
                label,
                geometry: { type: 'Polygon', coordinates: polygonCoordinates(polygon.geometry_wkt) },
                bbox: polygon.bbox,
                centroid: null,
                areaPixels: polygon.area_px,
                confidence: polygon.confidence,
                scoreMeaning: 'component_mean_softmax',
            });
        }),
    );
    const icons = raw.icon_detections.map((icon) =>
        DetectedPropertyZod.parse({
            type: 'icon',
            label: icon.class,
            geometry: { type: 'Polygon', coordinates: rectangle(icon.bbox) },
            bbox: icon.bbox,
            centroid: [icon.centroid_x, icon.centroid_y],
            areaPixels: icon.area_px,
            confidence: icon.confidence,
            scoreMeaning: 'component_mean_softmax',
        }),
    );
    const junctions = raw.junctions.map((junction) =>
        DetectedPropertyZod.parse({
            type: 'junction',
            label: 'Structural junction',
            geometry: { type: 'Point', coordinates: [junction.x, junction.y] },
            bbox: null,
            centroid: [junction.x, junction.y],
            areaPixels: null,
            confidence: junction.confidence,
            scoreMeaning: 'structural_heatmap_peak',
        }),
    );
    return [...rooms, ...icons, ...junctions];
}

async function readPrediction(response: Response): Promise<CubiPrediction> {
    if (!response.body) throw new Error('The inference service returned an empty response.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of response.body) {
        length += chunk.byteLength;
        if (length > MAX_RESPONSE_BYTES) throw new Error('The inference response exceeds the supported size.');
        chunks.push(chunk);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const parsed = CubiPredictionZod.safeParse(data);
    if (!parsed.success) throw new Error('The inference service returned an invalid prediction.');
    return parsed.data;
}

export async function predictRaster(params: PredictRasterParams): Promise<{ raw: CubiPrediction; detectedProperties: DetectedProperty[] }> {
    if (!Env.INFERENCE_BASE_URL || !Env.INFERENCE_API_KEY) throw new Error('The inference service is not configured.');
    const signal = AbortSignal.any([params.signal, AbortSignal.timeout(Env.INFERENCE_TIMEOUT_MS)]);
    const url = new URL('/v1/predictions', Env.INFERENCE_BASE_URL);
    try {
        for (let attempt = 0; attempt <= MAX_BUSY_RETRIES; attempt += 1) {
            signal.throwIfAborted();
            const body = new FormData();
            body.set('image', new Blob([new Uint8Array(params.raster.bytes)], { type: 'image/png' }), 'page.png');
            const response = await fetch(url, { method: 'POST', headers: { 'X-API-Key': Env.INFERENCE_API_KEY }, body, signal, redirect: 'error' });
            if (response.status === 503 && attempt < MAX_BUSY_RETRIES) {
                const retryAfter = Number(response.headers.get('Retry-After'));
                const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) : 5;
                await response.body?.cancel();
                await delay(seconds * 1000, undefined, { signal });
                continue;
            }
            if (!response.ok) {
                await response.body?.cancel();
                if (response.status === 401) throw new Error('Inference authentication failed. Check the server configuration.');
                if (response.status === 503) throw new Error('The inference service is busy. Retry detection shortly.');
                if ([413, 415, 422].includes(response.status)) throw new Error('The inference service cannot process this image or its size.');
                throw new Error('The inference service request failed.');
            }
            const raw = await readPrediction(response);
            const transform = raw.probability_grid.transform;
            if (transform.original_width !== params.raster.width || transform.original_height !== params.raster.height) {
                throw new Error('The inference response dimensions do not match the uploaded page.');
            }
            return { raw, detectedProperties: properties(raw) };
        }
        throw new Error('The inference service is busy. Retry detection shortly.');
    } catch (cause) {
        if (signal.aborted) throw new Error('Inference was interrupted or timed out. Retry detection.');
        // Preserve only our controlled failures. Never surface upstream bodies, connection URLs or request headers.
        if (cause instanceof Error && /^(The inference |Inference authentication |Invalid inference )/.test(cause.message)) throw cause;
        throw new Error('The inference service could not be reached or returned an invalid response.', { cause });
    }
}
