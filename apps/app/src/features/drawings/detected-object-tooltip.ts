import type { DetectedProperty, Drawing, PredictionPage } from '@repo/types';

type ObjectTooltipParams = Readonly<{ drawing: Drawing; page: PredictionPage; property: DetectedProperty; index: number }>;

const AREA_TO_SQUARE_METRES = { 'mm²': 0.000001, 'cm²': 0.0001, 'm²': 1, 'km²': 1000000, 'ft²': 0.09290304, 'in²': 0.00064516 };

export function formatDetectedObjectArea({ drawing, page, property }: ObjectTooltipParams): string {
    const blueprint = drawing.blueprints.find((item) => item.pageNumber === page.page);
    const room = property.type === 'room' ? blueprint?.layout?.rooms.find((item) => item.id === property.id) : null;
    const measurement = room?.class === property.label ? room.measurements.area : null;
    const printedArea = measurement ? measurement.value * AREA_TO_SQUARE_METRES[measurement.unit] : null;
    const userCalibration = blueprint?.ppm?.userCalibration;
    const userArea = userCalibration?.entityId === property.id ? userCalibration.areaSquareMetres : null;
    const ppm = blueprint?.ppm?.value;
    const estimatedArea = ppm !== undefined && property.areaPixels !== null ? property.areaPixels / (ppm * ppm) : null;
    const hasPrintedArea = printedArea !== null && Number.isFinite(printedArea) && printedArea > 0;
    const hasUserArea = userArea !== null && Number.isFinite(userArea) && userArea > 0;
    const area = hasUserArea ? userArea : hasPrintedArea ? printedArea : estimatedArea;
    return area !== null && Number.isFinite(area) && area > 0
        ? `${hasUserArea || hasPrintedArea ? '' : '≈'}${area.toLocaleString('en-US', { maximumSignificantDigits: 4 })} m²${!hasUserArea && !hasPrintedArea && blueprint?.ppm?.doorFallback ? ' (assumed door width)' : ''}`
        : 'Area unavailable';
}
