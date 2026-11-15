import { layoutPages } from './layout';
import { createContext, useContext, useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUnit } from 'effector-react';
import { createShapeId, useEditor, useValue } from 'tldraw';
import { getDetectedObjectColor, type DetectedProperty, type Drawing, type PredictionPage } from '@repo/types';
import { Tooltip, TooltipProvider } from '@repo/design-system/components/ui/tooltip';
import { remixIcons } from '@repo/design-system/lib/icons-remix';
import { formatDetectedObjectArea } from './detected-object-tooltip';
import { DetectedObjectTooltipCard } from './detected-object-tooltip-card';
import { authenticatedFetch } from '@/shared/auth';
import { config } from '@/shared/config';
import type { CanvasModel } from './canvas/model';

export const DetectionContext = createContext<{ drawing: Drawing; model: CanvasModel } | null>(null);
const LoaderCircle = remixIcons.loader;

function polygonPath(geometry: DetectedProperty['geometry']): string {
    if (geometry.type === 'Point') return '';
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.flatMap((polygon) => polygon.map((ring) => ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x},${y}`).join(' ') + 'Z')).join(' ');
}

function DetectionSheet({ page, drawing, model }: Readonly<{ page: PredictionPage; drawing: Drawing; model: CanvasModel }>) {
    const editor = useEditor();
    const clipId = useId();
    const shape = useValue('blueprint sheet', () => editor.getShape(createShapeId(`blueprint-${page.page}`)), [editor, page.page]);
    const zoom = useValue('geometry zoom', () => editor.getZoomLevel(), [editor]);
    const { selected, visibility, hiddenObjects } = useUnit({ selected: model.$selection, visibility: model.$visibility, hiddenObjects: model.$hiddenObjects });
    const blueprint = drawing.blueprints.find((item) => item.pageNumber === page.page);
    const entities = new Map([...(blueprint?.layout?.rooms ?? []), ...(blueprint?.layout?.fixtures ?? [])].map((entity) => [entity.id, entity]));
    const [url, setUrl] = useState<string | null>(null);
    const { data: raster, isError } = useQuery({
        queryKey: ['prediction-raster', drawing.id, page.rasterFileId],
        staleTime: Infinity,
        queryFn: async () => {
            const response = await authenticatedFetch(`${config.API_URL}/api/drawings/${drawing.id}/predictions/${page.page}/image`);
            if (!response.ok) throw new Error('Could not load the detection image.');
            return response.blob();
        },
    });
    useEffect(() => {
        if (!raster) return;
        const source = URL.createObjectURL(raster);
        setUrl(source);
        return () => URL.revokeObjectURL(source);
    }, [raster]);
    if (!shape || shape.type !== 'image') return null;
    const transform = editor.getShapePageTransform(shape);
    if (!transform) return null;
    const scaleX = shape.props.w / page.width;
    const scaleY = shape.props.h / page.height;
    return (
        <g transform={`matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})`}>
            {isError && (
                <text role="alert" x={8} y={20} fill="#dc2626">
                    Detection image unavailable. Reopen drawing to retry.
                </text>
            )}
            {url && (
                <g transform={`scale(${scaleX} ${scaleY})`}>
                    <clipPath id={clipId}>
                        <rect width={page.width} height={page.height} />
                    </clipPath>
                    <g clipPath={`url(#${clipId})`}>
                        {/* Use the exact normalized inference raster, including its EXIF/PDF orientation. */}
                        <image href={url} width={page.width} height={page.height} preserveAspectRatio="none" />
                        {page.detectedProperties.map((property, index) => {
                            if (!visibility[property.type] || hiddenObjects.includes(`${page.page}:${index}`)) return null;
                            const isSelected = selected.some((item) => item.page === page.page && item.index === index);
                            const label = `${property.label}, sheet ${page.page}${property.confidence === null ? ', needs review' : `, model score ${Math.round(property.confidence * 100)}%`}`;
                            const select = (additive: boolean) =>
                                additive ? model.selectionToggled({ page: page.page, index }) : model.selected({ page: page.page, index });
                            const color = getDetectedObjectColor(property);
                            const area = formatDetectedObjectArea({ drawing, page, property, index });
                            const processing = entities.get(property.id)?.enrichment.type === 'processing';
                            const center =
                                property.centroid ??
                                (property.bbox
                                    ? [(property.bbox[0] + property.bbox[2]) / 2, (property.bbox[1] + property.bbox[3]) / 2]
                                    : property.geometry.type === 'Point'
                                      ? property.geometry.coordinates
                                      : null);
                            const common = {
                                className: 'detection-target hover:opacity-75 focus:outline-none focus:stroke-[3]',
                                'data-detected-object': true,
                                'data-detected-type': property.type,
                                'data-detected-page': page.page,
                                'data-detected-index': index,
                                role: 'button',
                                tabIndex: 0,
                                'aria-label': label,
                                'aria-pressed': isSelected,
                                onKeyDown: (event: KeyboardEvent<SVGElement>) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        select(event.shiftKey);
                                    }
                                },
                                style: { pointerEvents: 'all' as const, cursor: 'pointer', color },
                                stroke: color,
                                strokeWidth: property.type === 'room' || property.type === 'slab' ? 3 : 1.5,
                                vectorEffect: 'non-scaling-stroke',
                            };
                            return (
                                <g key={property.id}>
                                    <Tooltip
                                        content={<DetectedObjectTooltipCard label={property.label} area={area} confidence={property.confidence} />}
                                        bubbleStyle={{ backgroundColor: color, color: '#ffffff', padding: 0 }}
                                        contentClassName="z-[300000] pointer-events-none [text-box:normal]"
                                        disableHoverablePopup
                                    >
                                        {property.geometry.type !== 'Point' ? (
                                            <path {...common} d={polygonPath(property.geometry)} fillRule="evenodd" />
                                        ) : (
                                            <circle
                                                {...common}
                                                cx={property.geometry.coordinates[0]}
                                                cy={property.geometry.coordinates[1]}
                                                r={3 / (zoom * Math.max(scaleX, scaleY))}
                                            />
                                        )}
                                    </Tooltip>
                                    {processing && center && (
                                        <g
                                            transform={`translate(${center[0]} ${center[1]}) scale(${1 / (zoom * scaleX)} ${1 / (zoom * scaleY)})`}
                                            style={{ pointerEvents: 'none' }}
                                        >
                                            <foreignObject x={-12} y={-12} width={24} height={24}>
                                                <div
                                                    role="status"
                                                    aria-label={`Describing ${property.label}, sheet ${page.page}`}
                                                    className="flex size-6 items-center justify-center"
                                                    style={{ color, pointerEvents: 'none' }}
                                                >
                                                    <LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" />
                                                </div>
                                            </foreignObject>
                                        </g>
                                    )}
                                </g>
                            );
                        })}
                    </g>
                </g>
            )}
        </g>
    );
}

function SheetName({ page, name, multiple }: Readonly<{ page: number; name: string; multiple: boolean }>) {
    const editor = useEditor();
    const shape = useValue('sheet label position', () => editor.getShape(createShapeId(`blueprint-${page}`)), [editor, page]);
    const zoom = useValue('sheet label zoom', () => editor.getZoomLevel(), [editor]);
    if (!shape || shape.type !== 'image') return null;
    const transform = editor.getShapePageTransform(shape);
    const label = multiple ? `${name} · Sheet ${page}` : name;
    return (
        <g transform={`matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})`}>
            <text x={0} y={-12 / zoom} fill="var(--muted-foreground)" fontSize={14 / zoom} fontWeight={400}>
                <title>{label}</title>
                {label.length > 60 ? `${label.slice(0, 57)}…` : label}
            </text>
        </g>
    );
}

export function DetectionCanvasLayer() {
    const context = useContext(DetectionContext);
    if (!context) return null;
    return (
        <TooltipProvider>
            <svg
                aria-label="Detected geometry"
                style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none', zIndex: 100000 }}
            >
                {context.drawing.blueprints.map((blueprint) => (
                    <SheetName
                        key={blueprint.id}
                        page={blueprint.pageNumber}
                        name={blueprint.attachment.name}
                        multiple={context.drawing.blueprints.length > 1}
                    />
                ))}
                {layoutPages(context.drawing.blueprints).map((page) => (
                    <DetectionSheet key={page.rasterFileId} page={page} drawing={context.drawing} model={context.model} />
                ))}
            </svg>
        </TooltipProvider>
    );
}
