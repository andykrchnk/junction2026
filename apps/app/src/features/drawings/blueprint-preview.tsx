import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import type { Drawing, Observation } from '@repo/types';
import { Button } from '@repo/design-system/components/ui/button';
import { authenticatedFetch } from '@/shared/auth';
import { config } from '@/shared/config';

type PreviewStatus = 'loading' | 'ready' | 'failed';

function PdfPage({ file, page, onStatus }: Readonly<{ file: Blob; page: number; onStatus: (status: PreviewStatus) => void }>) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState(false);
    useEffect(() => {
        let disposed = false;
        let loading: PDFDocumentLoadingTask | null = null;
        let rendering: RenderTask | null = null;
        onStatus('loading');
        setError(false);
        void (async () => {
            const pdf = await import('pdfjs-dist');
            if (disposed) return;
            pdf.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
            const data = new Uint8Array(await file.arrayBuffer());
            if (disposed) return;
            loading = pdf.getDocument({ data });
            const document = await loading.promise;
            const pdfPage = await document.getPage(page);
            if (disposed || !canvasRef.current) return;
            const original = pdfPage.getViewport({ scale: 1 });
            const viewport = pdfPage.getViewport({ scale: Math.min(2, 2400 / Math.max(original.width, original.height)) });
            const canvas = canvasRef.current;
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            rendering = pdfPage.render({ canvas, viewport });
            await rendering.promise;
            if (!disposed) onStatus('ready');
        })().catch(() => {
            if (!disposed) {
                setError(true);
                onStatus('failed');
            }
        });
        return () => {
            disposed = true;
            rendering?.cancel();
            void loading?.destroy();
        };
    }, [file, page, onStatus]);
    return (
        <>
            <canvas ref={canvasRef} className="block h-auto w-full" aria-label={`Blueprint page ${page}`} />
            {error && (
                <p role="alert" className="p-3 text-sm text-destructive">
                    Could not render this PDF page. Download the original to inspect it.
                </p>
            )}
        </>
    );
}

function ObservationDetails({ observation }: Readonly<{ observation: Observation }>) {
    return (
        <div className="rounded-md border bg-card p-3 text-sm" aria-live="polite">
            <p className="font-medium">
                {observation.label ?? observation.kind.replaceAll('_', ' ')} ·{' '}
                {observation.recognition === 'uncertain' ? 'Uncertain recognition' : 'Clear recognition'}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
                Page {observation.page} · {observation.location}
            </p>
            <p className="mt-2">{observation.fact}</p>
            <p className="text-muted-foreground mt-1 text-xs">Evidence: {observation.evidence}</p>
            <p className="text-muted-foreground mt-1 text-xs">
                Visibility: {observation.visibility} · Construction state: {observation.constructionState}
            </p>
            {observation.assumptions.length > 0 && (
                <div className="mt-2 text-xs">
                    <p className="font-medium">Assumptions · unverified</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                        {observation.assumptions.map((assumption, index) => (
                            <li key={index}>{assumption}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

export function BlueprintPreview({ drawing }: Readonly<{ drawing: Drawing }>) {
    const [url, setUrl] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState<PreviewStatus>('loading');
    const [showHighlights, setShowHighlights] = useState(true);
    const [kind, setKind] = useState('all');
    const [zoom, setZoom] = useState(1);
    const [selected, setSelected] = useState<number | null>(null);
    const { data, isError } = useQuery({
        queryKey: ['blueprint-file', drawing.id],
        queryFn: async () => {
            const response = await authenticatedFetch(`${config.API_URL}/api/drawings/${drawing.id}/file`);
            if (!response.ok) throw new Error('Could not load blueprint.');
            return response.blob();
        },
    });
    useEffect(() => {
        if (!data) return;
        const objectUrl = URL.createObjectURL(data);
        setUrl(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [data]);
    const observations = drawing.analysis?.observations ?? [];
    const candidates = observations.flatMap((observation, index) => (observation.page === page && observation.boundingBox ? [{ observation, index }] : []));
    const visible = candidates.filter(({ observation }) => kind === 'all' || observation.kind === kind);
    const selectedObservation = selected === null ? null : observations[selected];
    const kinds = [...new Set(candidates.map(({ observation }) => observation.kind))];
    const pages = drawing.attachment?.pages ?? 1;
    return (
        <details className="rounded-md border bg-card p-3" open>
            <summary className="cursor-pointer text-sm">Original blueprint · {drawing.attachment?.name}</summary>
            {url && data ? (
                <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                        <a href={url} download={drawing.attachment?.name} className="text-primary underline">
                            Download original
                        </a>
                        {pages > 1 && (
                            <label className="flex items-center gap-2">
                                Page
                                <select
                                    className="rounded border bg-background p-1"
                                    value={page}
                                    onChange={(event) => {
                                        setStatus('loading');
                                        setPage(Number(event.target.value));
                                        setSelected(null);
                                        setKind('all');
                                    }}
                                >
                                    {Array.from({ length: pages }, (_, index) => (
                                        <option key={index} value={index + 1}>
                                            {index + 1} of {pages}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={zoom <= 1}
                            onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
                            aria-label="Zoom out"
                        >
                            −
                        </Button>
                        <span>{Math.round(zoom * 100)}%</span>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={zoom >= 3}
                            onClick={() => setZoom((value) => Math.min(3, value + 0.5))}
                            aria-label="Zoom in"
                        >
                            +
                        </Button>
                    </div>
                    {drawing.analysis && (
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={showHighlights} onChange={(event) => setShowHighlights(event.target.checked)} />
                                Show highlights
                            </label>
                            <label className="flex items-center gap-2">
                                Object type
                                <select
                                    className="rounded border bg-background p-1"
                                    value={kind}
                                    onChange={(event) => {
                                        setKind(event.target.value);
                                        setSelected(null);
                                    }}
                                >
                                    <option value="all">All types</option>
                                    {kinds.map((value) => (
                                        <option key={value} value={value}>
                                            {value.replaceAll('_', ' ')}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <span>{visible.length} highlighted candidates · not a complete count</span>
                        </div>
                    )}
                    <div className="max-h-[65svh] overflow-auto rounded border bg-white">
                        <div className="relative" style={{ width: `${zoom * 100}%` }}>
                            {drawing.attachment?.mediaType === 'application/pdf' ? (
                                <PdfPage file={data} page={page} onStatus={setStatus} />
                            ) : (
                                <img
                                    alt="Original blueprint"
                                    src={url}
                                    className="block h-auto w-full"
                                    onLoad={() => setStatus('ready')}
                                    onError={() => setStatus('failed')}
                                />
                            )}
                            {status === 'ready' && showHighlights && (
                                <svg
                                    viewBox="0 0 1000 1000"
                                    preserveAspectRatio="none"
                                    className="pointer-events-none absolute inset-0 h-full w-full"
                                    aria-label="Approximate observation highlights"
                                >
                                    {visible.map(({ observation, index }) => {
                                        const box = observation.boundingBox;
                                        if (!box) return null;
                                        return (
                                            <rect
                                                key={index}
                                                x={box.left * 1000}
                                                y={box.top * 1000}
                                                width={(box.right - box.left) * 1000}
                                                height={(box.bottom - box.top) * 1000}
                                                role="button"
                                                tabIndex={0}
                                                aria-pressed={selected === index}
                                                aria-label={`${observation.label ?? observation.kind}, ${observation.recognition} recognition, ${observation.location}`}
                                                onClick={() => setSelected(index)}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault();
                                                        setSelected(index);
                                                    }
                                                }}
                                                className="pointer-events-auto cursor-pointer focus:outline-none focus:stroke-[4]"
                                                fill={selected === index ? 'rgba(37, 99, 235, 0.2)' : 'transparent'}
                                                stroke={observation.recognition === 'uncertain' ? '#b45309' : '#2563eb'}
                                                strokeWidth={selected === index ? 3 : 1.5}
                                                strokeDasharray={observation.recognition === 'uncertain' ? '6 4' : undefined}
                                                vectorEffect="non-scaling-stroke"
                                            >
                                                <title>
                                                    {observation.label ?? observation.kind} · {observation.recognition}
                                                </title>
                                            </rect>
                                        );
                                    })}
                                </svg>
                            )}
                        </div>
                    </div>
                    {status === 'loading' && (
                        <p role="status" className="text-sm">
                            Preparing page preview…
                        </p>
                    )}
                    {status === 'failed' && drawing.attachment?.mediaType !== 'application/pdf' && (
                        <p role="alert" className="text-sm text-destructive">
                            Could not display this image. Download the original to inspect it.
                        </p>
                    )}
                    {drawing.analysis && (
                        <>
                            <p className="text-muted-foreground text-xs">
                                Blue: clear recognition. Dashed amber: uncertain. Boxes are approximate visual references, not measured boundaries or
                                probability scores.
                            </p>
                            {visible.length > 0 ? (
                                <div className="flex max-h-28 flex-wrap gap-2 overflow-auto" aria-label="Select highlighted observation">
                                    {visible.map(({ observation, index }) => (
                                        <Button key={index} variant="secondary" size="sm" aria-pressed={selected === index} onClick={() => setSelected(index)}>
                                            {observation.label ?? observation.kind} · {observation.recognition}
                                        </Button>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-muted-foreground text-xs">
                                    No saved boxes for this page and filter. The written analysis may still contain useful observations.
                                </p>
                            )}
                            {selectedObservation && <ObservationDetails observation={selectedObservation} />}
                        </>
                    )}
                </div>
            ) : (
                <p className="mt-2 text-sm" role="status">
                    {isError ? 'Could not load blueprint. Reopen the session to retry.' : 'Loading blueprint…'}
                </p>
            )}
        </details>
    );
}
