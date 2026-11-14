import type { DetectedProperty, Drawing, PredictionPage } from '@repo/types';

type ObjectTooltipParams = Readonly<{ drawing: Drawing; page: PredictionPage; property: DetectedProperty; index: number }>;

const AREA_TO_SQUARE_METRES = { 'mm²': 0.000001, 'cm²': 0.0001, 'm²': 1, 'km²': 1000000, 'ft²': 0.09290304, 'in²': 0.00064516 };

export function formatDetectedObjectArea({ drawing, page, property, index }: ObjectTooltipParams): string {
    // Processing properties retain rooms first, in the same order as the raw response.
    const room = property.type === 'room' && 'rooms' in page.raw ? page.raw.rooms[index] : null;
    const measurement = room?.class === property.label ? room.measurements.area : null;
    const printedArea = measurement ? measurement.value * AREA_TO_SQUARE_METRES[measurement.unit] : null;
    const ppm = drawing.ppm?.value;
    const estimatedArea = ppm !== undefined && property.areaPixels !== null ? property.areaPixels / (ppm * ppm) : null;
    const hasPrintedArea = printedArea !== null && Number.isFinite(printedArea) && printedArea > 0;
    const area = hasPrintedArea ? printedArea : estimatedArea;
    return area !== null && Number.isFinite(area) && area > 0
        ? `${hasPrintedArea ? '' : '≈'}${area.toLocaleString('en-US', { maximumSignificantDigits: 4 })} m²`
        : 'Area unavailable';
}

export function formatDetectedObjectTooltip(params: ObjectTooltipParams): string {
    return `${params.property.label}, ${formatDetectedObjectArea(params)}, ${params.property.confidence.toFixed(2)}`;
}
