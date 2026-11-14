import { useEffect, useState } from 'react';
import { useUnit } from 'effector-react';
import { useTheme } from 'next-themes';
import { CanvasStateZod, type Drawing } from '@repo/types';
import {
    AssetRecordType,
    createTLStore,
    PageRecordType,
    createShapeId,
    getSnapshot,
    parseTldrawJsonFile,
    Tldraw,
    useValue,
    type Editor,
    type TLAssetStore,
    type TLPageId,
} from 'tldraw';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import { Button } from '@/components/ui/button';
import { authenticatedFetch } from '@/shared/auth';
import { config } from '@/shared/config';
import { createCanvasModel, type CanvasModel, type LoadedCanvas } from './canvas/model';
import { readLocal, ViewZod, writeLocal } from './canvas-storage';
import 'tldraw/tldraw.css';

type BlueprintPage = Readonly<{ src: string; width: number; height: number }>;
type Preparation =
    { type: 'loading' } | { type: 'ready'; pages: BlueprintPage[]; saved: LoadedCanvas; recovery: LoadedCanvas | null } | { type: 'error'; message: string };

async function preparePages(drawing: Drawing): Promise<BlueprintPage[]> {
    const response = await authenticatedFetch(`${config.API_URL}/api/drawings/${drawing.id}/file`);
    if (!response.ok) throw new Error('Could not load the blueprint. Try opening it again.');
    const blob = await response.blob();
    if (drawing.attachment?.mediaType !== 'application/pdf') {
        const bitmap = await createImageBitmap(blob);
        const page = { src: URL.createObjectURL(blob), width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return [page];
    }
    const pdf = await import('pdfjs-dist');
    pdf.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const task = pdf.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
    const pages: BlueprintPage[] = [];
    try {
        const document = await task.promise;
        for (let number = 1; number <= document.numPages; number++) {
            const page = await document.getPage(number);
            const original = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(original.width, original.height)) });
            const canvas = window.document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvas, viewport }).promise;
            const image = await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Could not render PDF page.'))), 'image/png'),
            );
            pages.push({ src: URL.createObjectURL(image), width: canvas.width, height: canvas.height });
            canvas.width = 0;
            canvas.height = 0;
            page.cleanup();
        }
        return pages;
    } catch (error) {
        pages.forEach((page) => URL.revokeObjectURL(page.src));
        throw error;
    } finally {
        await task.destroy();
    }
}

function serializeDocument(editor: Editor): string {
    const { document } = getSnapshot(editor.store);
    return JSON.stringify({ tldrawFileFormatVersion: 1, schema: document.schema, records: Object.values(document.store) });
}

function CanvasEditor({
    drawing,
    pages,
    saved,
    recovery,
    storageKey,
    model,
}: Readonly<{
    drawing: Drawing;
    pages: BlueprintPage[];
    saved: LoadedCanvas;
    recovery: LoadedCanvas | null;
    storageKey: string;
    model: CanvasModel;
}>) {
    const { resolvedTheme } = useTheme();
    const status = useUnit(model.$status);
    const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
    const currentPage = useValue('blueprint page', () => activeEditor?.getCurrentPageId() ?? '', [activeEditor]);
    const zoom = useValue('blueprint zoom', () => activeEditor?.getZoomLevel() ?? 1, [activeEditor]);
    const [error, setError] = useState<string | null>(null);
    const [recoveryConflict, setRecoveryConflict] = useState(!!recovery?.document && recovery.revision !== saved.revision);
    const [assets] = useState<TLAssetStore>(() => ({
        upload: async () => {
            throw new Error('Add blueprints through the drawing upload.');
        },
        resolve: async (asset) => {
            const page = asset.meta.blueprintPage;
            return typeof page === 'number' ? (pages[page - 1]?.src ?? null) : null;
        },
    }));
    const [store] = useState(() => createTLStore({ assets }));

    useEffect(() => {
        const timer = window.setInterval(() => model.saveRequested(), 5000);
        const warnUnsaved = (event: BeforeUnloadEvent) => {
            if (model.$status.getState().type !== 'saved') event.preventDefault();
        };
        window.addEventListener('beforeunload', warnUnsaved);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('beforeunload', warnUnsaved);
            model.saveRequested();
        };
    }, [model]);

    useEffect(() => {
        activeEditor?.user.updateUserPreferences({ colorScheme: resolvedTheme === 'dark' ? 'dark' : 'light' });
    }, [resolvedTheme, activeEditor]);

    const mount = (editor: Editor) => {
        try {
            editor.user.updateUserPreferences({ colorScheme: resolvedTheme === 'dark' ? 'dark' : 'light' });
            const document = recovery?.document && recovery.revision === saved.revision ? recovery.document : saved.document;
            if (document) {
                const parsed = parseTldrawJsonFile({ json: document, schema: editor.store.schema });
                if (!parsed.ok) throw new Error('This saved canvas could not be opened. Your saved document has not been changed.');
                editor.store.loadStoreSnapshot(parsed.value.getStoreSnapshot());
            } else {
                const firstPage = editor.getCurrentPageId();
                pages.forEach((page, index) => {
                    const pageId: TLPageId = index === 0 ? firstPage : PageRecordType.createId(`blueprint-${index + 1}`);
                    if (index > 0) editor.createPage({ id: pageId, name: `Page ${index + 1}` });
                    else editor.updatePage({ id: pageId, name: 'Page 1' });
                    editor.setCurrentPage(pageId);
                    const assetId = AssetRecordType.createId(`blueprint-${drawing.attachment?.id}-${index + 1}`);
                    editor.createAssets([
                        {
                            id: assetId,
                            type: 'image',
                            typeName: 'asset',
                            props: {
                                name: drawing.title,
                                src: `https://blueprint.invalid/${index + 1}`,
                                w: page.width,
                                h: page.height,
                                mimeType: 'image/png',
                                isAnimated: false,
                            },
                            meta: { blueprintPage: index + 1 },
                        },
                    ]);
                    editor.createShape({
                        id: createShapeId(`blueprint-${index + 1}`),
                        type: 'image',
                        x: 0,
                        y: 0,
                        isLocked: true,
                        props: { assetId, w: page.width, h: page.height },
                    });
                });
                editor.setCurrentPage(firstPage);
            }
            const view = ViewZod.safeParse(readLocal(`${storageKey}:view`));
            const page = view.success ? editor.getPages().find((item) => item.id === view.data.page) : null;
            if (view.success && page) {
                editor.setCurrentPage(page.id);
                editor.setCamera(view.data.camera);
            } else editor.zoomToFit();
            editor.clearHistory();
            editor.updateInstanceState({ isReadonly: true });
            editor.setCurrentTool('hand');
            setActiveEditor(editor);
            // Uploaded assets need durable storage. Keep file/URL insertion disabled until that exists.
            editor.registerExternalContentHandler('files', async () => {
                setError('Upload a blueprint in a new drawing session.');
            });
            editor.registerExternalContentHandler('url', async () => {
                setError('Pasting external assets is not supported in this workspace yet.');
            });
            if (!saved.document || document !== saved.document) model.changed(serializeDocument(editor));
            const stopDocument = editor.store.listen(
                () => {
                    const document = serializeDocument(editor);
                    const retained = writeLocal(`${storageKey}:recovery`, { document, revision: model.$revision.getState() });
                    if (!retained) setError('Local recovery storage is unavailable. Keep this page open until the canvas is saved.');
                    model.changed(document);
                },
                { scope: 'document', source: 'user' },
            );
            let viewTimer: ReturnType<typeof setTimeout> | undefined;
            const saveView = () => writeLocal(`${storageKey}:view`, { page: editor.getCurrentPageId(), camera: editor.getCamera() });
            const stopSession = editor.store.listen(
                () => {
                    clearTimeout(viewTimer);
                    viewTimer = setTimeout(saveView, 250);
                },
                { scope: 'session' },
            );
            return () => {
                stopDocument();
                stopSession();
                clearTimeout(viewTimer);
                saveView();
            };
        } catch (cause) {
            editor.updateInstanceState({ isReadonly: true });
            setError(cause instanceof Error ? cause.message : 'Could not open canvas.');
        }
    };

    if (recoveryConflict)
        return (
            <div className="m-auto max-w-md p-6 text-sm">
                <p>A local recovery draft and a newer saved canvas both exist. Your draft has been kept.</p>
                <div className="mt-4 flex gap-3">
                    <Button
                        onClick={() => {
                            const url = URL.createObjectURL(new Blob([recovery?.document ?? ''], { type: 'application/json' }));
                            const link = window.document.createElement('a');
                            link.href = url;
                            link.download = `${drawing.id}-recovery.tldr`;
                            link.click();
                            URL.revokeObjectURL(url);
                        }}
                    >
                        Download recovery
                    </Button>
                    <Button variant="secondary" onClick={() => setRecoveryConflict(false)}>
                        Open saved canvas
                    </Button>
                </div>
            </div>
        );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b px-3 py-1 text-xs">
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Drag to pan</span>
                    {pages.length > 1 && (
                        <select
                            aria-label="Blueprint page"
                            value={currentPage}
                            className="max-w-32 rounded border bg-background p-1"
                            onChange={(event) => {
                                const page = activeEditor?.getPages().find((page) => page.id === event.target.value);
                                if (page) {
                                    activeEditor?.setCurrentPage(page.id);
                                    activeEditor?.zoomToFit();
                                }
                            }}
                        >
                            {activeEditor?.getPages().map((page) => (
                                <option key={page.id} value={page.id}>
                                    {page.name}
                                </option>
                            ))}
                        </select>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <span role="status">
                        {status.type === 'saved'
                            ? 'Saved'
                            : status.type === 'saving'
                              ? 'Saving…'
                              : status.type === 'dirty'
                                ? 'Unsaved changes'
                                : 'Couldn’t save'}
                    </span>
                    <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => activeEditor?.zoomOut()}>
                        −
                    </Button>
                    <span className="min-w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                    <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => activeEditor?.zoomIn()}>
                        +
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => activeEditor?.zoomToFit()}>
                        Fit drawing
                    </Button>
                </div>
            </div>
            {(error || status.type === 'error') && (
                <div role="alert" className="border-b bg-card px-3 py-2 text-xs text-destructive">
                    {error ?? (status.type === 'error' ? status.message : '')}
                    {status.type === 'error' && !status.conflict && (
                        <Button size="sm" variant="ghost" onClick={() => model.saveRequested()}>
                            Retry save
                        </Button>
                    )}
                </div>
            )}
            <div className="relative min-h-0 flex-1" aria-label="Blueprint canvas">
                <Tldraw store={store} onMount={mount} hideUi licenseKey={config.TLDRAW_LICENSE_KEY} options={{ maxPages: 10 }} />
            </div>
        </div>
    );
}

export default function BlueprintCanvas({ drawing, userId }: Readonly<{ drawing: Drawing; userId: string }>) {
    const storageKey = `junction:canvas:${userId}:${drawing.id}`;
    const [model] = useState(() => createCanvasModel(drawing.id, storageKey));
    const [preparation, setPreparation] = useState<Preparation>({ type: 'loading' });
    useEffect(() => {
        let disposed = false;
        let pages: BlueprintPage[] = [];
        void (async () => {
            const saved = await model.loadFx();
            pages = await preparePages(drawing);
            if (disposed) {
                pages.forEach((page) => URL.revokeObjectURL(page.src));
                return;
            }
            const parsed = CanvasStateZod.safeParse(readLocal(`${storageKey}:recovery`));
            const recovery = parsed.success && parsed.data.document !== saved.document ? parsed.data : null;
            setPreparation({ type: 'ready', saved, pages, recovery });
        })().catch((error: unknown) => {
            if (!disposed) setPreparation({ type: 'error', message: error instanceof Error ? error.message : 'Could not load canvas.' });
        });
        return () => {
            disposed = true;
            pages.forEach((page) => URL.revokeObjectURL(page.src));
        };
        // Attachment identity is immutable within a drawing session.
    }, [drawing.id, model, storageKey]);

    if (preparation.type === 'loading')
        return (
            <p role="status" className="m-auto p-6 text-sm text-muted-foreground">
                Opening blueprint canvas…
            </p>
        );
    if (preparation.type === 'error')
        return (
            <p role="alert" className="m-auto p-6 text-sm text-destructive">
                {preparation.message} Reopen the drawing to retry.
            </p>
        );
    return <CanvasEditor key={drawing.id} drawing={drawing} model={model} storageKey={storageKey} {...preparation} />;
}
