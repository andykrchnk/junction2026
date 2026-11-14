import { setTimeout as delay } from 'node:timers/promises';
import { ProcessingPredictionZod, DetectedPropertyZod } from '@repo/types';
import type { ProcessingPrediction, DetectedProperty } from '@repo/types';
import { Env } from '../../shared/env';
import type { Raster } from './raster';
import { z } from 'zod';

export class InferenceError extends Error {}

const ProviderErrorZod = z.object({ code: z.string().optional() });

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BUSY_RETRIES = 2;
type PredictRasterParams = { raster: Raster; signal: AbortSignal };

function properties(raw: ProcessingPrediction): DetectedProperty[] {
    return [
        ...raw.rooms.map((room) => ({ type: 'room' as const, object: room })),
        ...raw.fixtures.map((fixture) => ({ type: 'icon' as const, object: fixture })),
    ].map(({ type, object }) => {
        const polygons = object.geometry.type === 'Polygon' ? [object.geometry.coordinates] : object.geometry.coordinates;
        const points = polygons.flat(2);
        const bbox = points.reduce<[number, number, number, number]>(
            (bounds, [x, y]) => [Math.min(bounds[0], x), Math.min(bounds[1], y), Math.max(bounds[2], x), Math.max(bounds[3], y)],
            [Infinity, Infinity, -Infinity, -Infinity],
        );
        const areaPixels = polygons.reduce(
            (total, polygon) =>
                total +
                polygon.reduce((area, ring, index) => {
                    const signed = ring.reduce((sum, [x, y], pointIndex) => {
                        const next = ring[(pointIndex + 1) % ring.length];
                        return sum + x * next[1] - next[0] * y;
                    }, 0);
                    return area + (index === 0 ? 1 : -1) * Math.abs(signed / 2);
                }, 0),
            0,
        );
        return DetectedPropertyZod.parse({
            type,
            label: object.class,
            geometry: object.geometry,
            bbox,
            centroid: null,
            areaPixels,
            confidence: object.confidence,
            scoreMeaning: 'processing_confidence',
        });
    });
}

async function readPrediction(response: Response): Promise<ProcessingPrediction> {
    if (!response.body) throw new Error('The inference service returned an empty response.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of response.body) {
        length += chunk.byteLength;
        if (length > MAX_RESPONSE_BYTES) throw new Error('The inference response exceeds the supported size.');
        chunks.push(chunk);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const parsed = ProcessingPredictionZod.safeParse(data);
    if (!parsed.success) throw new Error('The inference service returned an invalid prediction.');
    return parsed.data;
}

export async function predictRaster(params: PredictRasterParams): Promise<{ raw: ProcessingPrediction; detectedProperties: DetectedProperty[] }> {
    if (!Env.INFERENCE_BASE_URL || !Env.INFERENCE_API_KEY) throw new Error('The inference service is not configured.');
    const signal = AbortSignal.any([params.signal, AbortSignal.timeout(Env.INFERENCE_TIMEOUT_MS)]);
    const url = new URL('/v1/process', Env.INFERENCE_BASE_URL);
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
            if (raw.image.width !== params.raster.width || raw.image.height !== params.raster.height) {
                throw new Error('The inference response dimensions do not match the uploaded page.');
            }
            return { raw, detectedProperties: properties(raw) };
        }
        throw new Error('The inference service is busy. Retry detection shortly.');
    } catch (cause) {
        if (signal.aborted) throw new InferenceError('Inference was interrupted or timed out. Retry detection.');
        const providerError = ProviderErrorZod.safeParse(cause);
        if (providerError.success && providerError.data.code && /CERTIFICATE|CERT_|UNABLE_TO_VERIFY|SELF_SIGNED/.test(providerError.data.code)) {
            throw new InferenceError('The inference service TLS certificate could not be verified. Check the server certificate trust configuration.');
        }
        // Preserve only our controlled failures. Never surface upstream bodies, connection URLs or request headers.
        if (cause instanceof Error && /^(The inference |Inference authentication |Invalid inference )/.test(cause.message)) {
            throw new InferenceError(cause.message, { cause });
        }
        throw new InferenceError('The inference service could not be reached or returned an invalid response.', { cause });
    }
}
