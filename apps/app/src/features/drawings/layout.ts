import { DetectedPropertyZod, type Blueprint, type LayoutRoom, type LayoutFixture, type DetectedProperty, type PredictionPage } from '@repo/types';

type GeometryCandidate = Pick<LayoutRoom | LayoutFixture, 'id' | 'class' | 'confidence' | 'geometry'>;
export function layoutProperties(layout: Readonly<{ rooms: readonly GeometryCandidate[]; fixtures: readonly GeometryCandidate[] }>): DetectedProperty[] {
    return [
        ...layout.rooms.map((room) => ({ type: 'room' as const, entity: room })),
        ...layout.fixtures.map((fixture) => ({ type: 'icon' as const, entity: fixture })),
    ].map(({ type, entity }) => {
        const polygons = entity.geometry.type === 'Polygon' ? [entity.geometry.coordinates] : entity.geometry.coordinates;
        const points = polygons.flat(2);
        const bbox = points.reduce<[number, number, number, number]>(
            (bounds, [x, y]) => [Math.min(bounds[0], x), Math.min(bounds[1], y), Math.max(bounds[2], x), Math.max(bounds[3], y)],
            [Infinity, Infinity, -Infinity, -Infinity],
        );
        const areaPixels = polygons.reduce(
            (total, polygon) =>
                total +
                polygon.reduce((subtotal, ring, index) => {
                    const signed = ring.reduce((sum, [x, y], pointIndex) => {
                        const next = ring[(pointIndex + 1) % ring.length];
                        return sum + x * next[1] - next[0] * y;
                    }, 0);
                    return subtotal + (index === 0 ? 1 : -1) * Math.abs(signed / 2);
                }, 0),
            0,
        );
        return DetectedPropertyZod.parse({
            id: entity.id,
            type,
            label: entity.class,
            geometry: entity.geometry,
            bbox,
            centroid: null,
            areaPixels,
            confidence: entity.confidence,
            scoreMeaning: 'processing_confidence',
        });
    });
}

export function predictionPage(blueprint: Blueprint): PredictionPage | null {
    if (!blueprint.layout || !blueprint.raster) return null;
    return {
        page: blueprint.pageNumber,
        rasterFileId: blueprint.raster.fileId,
        width: blueprint.raster.width,
        height: blueprint.raster.height,
        coordinateSystem: 'uploaded_raster_pixels_top_left',
        raw: blueprint.layout.source.prediction,
        detectedProperties: layoutProperties(blueprint.layout),
        createdAt: blueprint.layout.source.createdAt,
    };
}

export function layoutPages(blueprints: readonly Blueprint[]): PredictionPage[] {
    return blueprints.flatMap((blueprint) => {
        const page = predictionPage(blueprint);
        return page ? [page] : [];
    });
}

// Number objects within each sheet category, matching the Layers hierarchy.
export function layerObjects(blueprints: readonly Blueprint[]) {
    return layoutPages(blueprints).flatMap((page) => {
        const counts = new Map<string, number>();
        return page.detectedProperties.map((property, index) => {
            const category = `${property.type}:${property.label}`;
            const number = (counts.get(category) ?? 0) + 1;
            counts.set(category, number);
            return { property, index, page: page.page, number, name: `${property.label} ${number}` };
        });
    });
}
