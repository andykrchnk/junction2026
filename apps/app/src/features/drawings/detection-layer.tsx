import { createContext, useContext, useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUnit } from 'effector-react';
import { createShapeId, useEditor, useValue } from 'tldraw';
import type { DetectedProperty, Drawing, PredictionPage } from '@repo/types';
import { Button } from '@/components/ui/button';
import { authenticatedFetch } from '@/shared/auth';
import { config } from '@/shared/config';
import type { CanvasModel } from './canvas/model';

export const DetectionContext = createContext<{ drawing: Drawing; model: CanvasModel } | null>(null);
const colors = { room: '#0d9488', icon: '#d97706', junction: '#7c3aed' };

function polygonPath(geometry: DetectedProperty['geometry']): string {
    if (geometry.type !== 'Polygon') return '';
    return geometry.coordinates.map((ring) => ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x},${y}`).join(' ') + 'Z').join(' ');
}

function DetectionSheet({ page, drawingId, model }: Readonly<{ page: PredictionPage; drawingId: string; model: CanvasModel }>) {
    const editor = useEditor();
    const clipId = useId();
    const shape = useValue('blueprint sheet', () => editor.getShape(createShapeId(`blueprint-${page.page}`)), [editor, page.page]);
    const zoom = useValue('geometry zoom', () => editor.getZoomLevel(), [editor]);
    const { selected, visibility } = useUnit({ selected: model.$selected, visibility: model.$visibility });
    const [url, setUrl] = useState<string | null>(null);
    const { data: raster, isError } = useQuery({
        queryKey: ['prediction-raster', drawingId, page.rasterFileId],
        staleTime: Infinity,
        queryFn: async () => {
            const response = await authenticatedFetch(`${config.API_URL}/api/drawings/${drawingId}/predictions/${page.page}/image`);
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
                            if (!visibility[property.type]) return null;
                            const isSelected = selected?.page === page.page && selected.index === index;
                            const label = `${property.label}, sheet ${page.page}, model score ${Math.round(property.confidence * 100)}%`;
                            const select = () => model.selected({ page: page.page, index });
                            const common = {
                                className: 'hover:opacity-75 focus:outline-none focus:stroke-[3]',
                                role: 'button',
                                tabIndex: 0,
                                'aria-label': label,
                                'aria-pressed': isSelected,
                                onPointerDown: select,
                                onKeyDown: (event: KeyboardEvent<SVGElement>) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        select();
                                    }
                                },
                                style: { pointerEvents: 'all' as const, cursor: 'pointer' },
                                stroke: isSelected ? '#e11d48' : colors[property.type],
                                strokeWidth: isSelected ? 3 : 1.5,
                                vectorEffect: 'non-scaling-stroke',
                            };
                            return property.geometry.type === 'Polygon' ? (
                                <path
                                    key={index}
                                    {...common}
                                    d={polygonPath(property.geometry)}
                                    fill={isSelected ? '#e11d4833' : `${colors[property.type]}18`}
                                    fillRule="evenodd"
                                >
                                    <title>{label}</title>
                                </path>
                            ) : (
                                <circle
                                    key={index}
                                    {...common}
                                    cx={property.geometry.coordinates[0]}
                                    cy={property.geometry.coordinates[1]}
                                    r={3 / (zoom * Math.max(scaleX, scaleY))}
                                    fill={colors.junction}
                                >
                                    <title>{label}</title>
                                </circle>
                            );
                        })}
                    </g>
                </g>
            )}
        </g>
    );
}

export function DetectionCanvasLayer() {
    const context = useContext(DetectionContext);
    if (!context) return null;
    return (
        <svg
            aria-label="Detected geometry"
            style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none', zIndex: 100000 }}
        >
            {context.drawing.detection?.pages.map((page) => (
                <DetectionSheet key={page.rasterFileId} page={page} drawingId={context.drawing.id} model={context.model} />
            ))}
        </svg>
    );
}

export function DetectionControls({ drawing, model }: Readonly<{ drawing: Drawing; model: CanvasModel }>) {
    const { selected, visibility } = useUnit({ selected: model.$selected, visibility: model.$visibility });
    const detectedPage = drawing.detection?.pages.find((page) => page.page === selected?.page);
    const property = selected ? detectedPage?.detectedProperties[selected.index] : null;
    if (!drawing.detection?.pages.some((page) => page.detectedProperties.length)) return null;
    return (
        <>
            <div aria-label="Geometry layers" className="absolute top-3 left-3 z-[300] flex flex-wrap gap-3 rounded border bg-card px-3 py-2 text-xs shadow-sm">
                {(['room', 'icon', 'junction'] as const).map((type) => (
                    <label key={type} className="flex items-center gap-1.5">
                        <input
                            type="checkbox"
                            checked={visibility[type]}
                            onChange={(event) => model.visibilityChanged({ type, visible: event.target.checked })}
                        />
                        {type === 'room' ? 'Rooms' : type === 'icon' ? 'Fixtures' : 'Junctions'}
                    </label>
                ))}
            </div>
            {property && (
                <section
                    aria-label="Detected element properties"
                    className="absolute bottom-3 left-3 z-[300] max-w-[calc(100%-1.5rem)] rounded border bg-card p-3 text-xs shadow-sm"
                >
                    <div className="flex items-center justify-between gap-5">
                        <span className="font-medium">
                            {property.label} · Sheet {selected?.page}
                        </span>
                        <Button size="sm" variant="ghost" aria-label="Close element properties" onClick={() => model.selected(null)}>
                            ×
                        </Button>
                    </div>
                    <p>
                        Model score: {Math.round(property.confidence * 100)}% ·{' '}
                        {property.scoreMeaning === 'component_mean_softmax' ? 'mean class score' : 'junction peak score'}
                    </p>
                    {property.areaPixels !== null && <p className="mt-1">Area: {Math.round(property.areaPixels).toLocaleString()} px²</p>}
                    <p className="mt-1 text-muted-foreground">Uncalibrated prediction · not a verified measurement</p>
                </section>
            )}
        </>
    );
}
