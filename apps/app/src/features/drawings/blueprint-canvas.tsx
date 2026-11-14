import { useEffect, useState, useId, useRef } from 'react';
import { useUnit } from 'effector-react';
import { useTheme } from 'next-themes';
import { useHotkeys } from 'react-hotkeys-hook';
import { CanvasStateZod, type Drawing } from '@repo/types';
import {
    AssetRecordType,
    createTLStore,
    createShapeId,
    getSnapshot,
    parseTldrawJsonFile,
    Tldraw,
    type Editor,
    type TLAssetStore,
    type TLGridProps,
} from 'tldraw';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import { Button } from '@repo/design-system/components/ui/button';
import { authenticatedFetch } from '@/shared/auth';
import { config } from '@/shared/config';
import { createCanvasModel, type CanvasModel, type LoadedCanvas } from './canvas/model';
import { readLocal, ViewZod, writeLocal } from './canvas-storage';
import { DetectionCanvasLayer, DetectionContext, DetectionControls } from './detection-layer';
import { CommentsContext, CommentCanvasLayer } from './comment-layer';
import { createCommentsModel } from './canvas/comments-model';
import 'tldraw/tldraw.css';
import './blueprint-canvas.css';

type SelectionGesture = {
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
    object: { page: number; index: number } | null;
};

function CanvasLayers() {
    return (
        <>
            <DetectionCanvasLayer />
            <CommentCanvasLayer />
        </>
    );
}

function CanvasBackground() {
    return <div className="tl-background" style={{ backgroundColor: 'var(--background)' }} />;
}

function SquareGrid({ x, y, z, size }: TLGridProps) {
    const id = useId();
    const spacing = size * z * Math.pow(2, Math.ceil(Math.log2(16 / (size * z))));
    return (
        <svg className="tl-grid" aria-hidden="true" width="100%" height="100%">
            <defs>
                <pattern id={id} width={spacing} height={spacing} patternUnits="userSpaceOnUse" x={x * z} y={y * z}>
                    <path d={`M ${spacing} 0 H 0 V ${spacing}`} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.16} strokeWidth={1} />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${id})`} />
        </svg>
    );
}

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

function combineSavedPages(editor: Editor): boolean {
    const savedPages = editor.getPages();
    const [first] = savedPages;
    if (!first || savedPages.length === 1) return false;
    editor.run(
        () => {
            let offset = 0;
            for (const page of savedPages) {
                const roots = [...editor.getPageShapeIds(page.id)].flatMap((id) => {
                    const shape = editor.getShape(id);
                    return shape?.parentId === page.id ? [shape] : [];
                });
                let right = 0;
                for (const shape of roots) {
                    right = Math.max(right, editor.getShapePageBounds(shape)?.maxX ?? shape.x);
                    if (page.id !== first.id) editor.reparentShapes([shape], first.id);
                    editor.updateShape({ id: shape.id, type: shape.type, x: shape.x + offset, y: shape.y });
                }
                if (roots.length) offset += Math.max(right, 600) + 80;
                if (page.id !== first.id) editor.deletePage(page.id);
            }
            editor.updatePage({ id: first.id, name: 'Blueprint' });
            editor.setCurrentPage(first.id);
        },
        { ignoreShapeLock: true },
    );
    return true;
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
    const [commentsModel] = useState(() => createCommentsModel(drawing.id));
    const { status, commentMode, openCommentId, selectedObject } = useUnit({
        status: model.$status,
        commentMode: commentsModel.$mode,
        openCommentId: commentsModel.$openId,
        selectedObject: model.$selected,
    });
    const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
    const [error, setError] = useState<string | null>(null);
    const selectionGesture = useRef<SelectionGesture | null>(null);
    useHotkeys(
        'c',
        (event) => {
            if (!activeEditor) return;
            commentsModel.modeChanged('comment');
            activeEditor.setCurrentTool('hand');
            activeEditor.focus();
            event.stopPropagation();
        },
        { enabled: activeEditor !== null, preventDefault: true, eventListenerOptions: { capture: true } },
        [activeEditor, commentsModel],
    );
    useHotkeys(
        'esc',
        (event) => {
            if (event.repeat || event.defaultPrevented) return;
            const target = event.target instanceof Element ? event.target : null;
            const commentUi = target?.closest('[data-comment-ui]');
            // Portaled menus/dialogs and text editors own Escape before canvas selection.
            if (!commentUi && target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
            if (openCommentId === null && target?.closest('input, textarea, select, [contenteditable="true"]')) return;
            if (openCommentId === null && commentMode === 'default' && document.querySelector('[data-detected-object][data-popup-open]')) return;
            event.preventDefault();
            event.stopPropagation();
            selectionGesture.current = null;
            if (openCommentId !== null) commentsModel.openChanged(null);
            else if (commentMode === 'comment') commentsModel.modeChanged('default');
            else model.selected(null);
        },
        {
            enabled: activeEditor !== null && (commentMode === 'comment' || openCommentId !== null || selectedObject !== null),
            enableOnFormTags: true,
            enableOnContentEditable: true,
            eventListenerOptions: { capture: true },
        },
        [activeEditor, commentsModel, openCommentId, commentMode, model],
    );
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
            let combinedPages = false;
            if (document) {
                const parsed = parseTldrawJsonFile({ json: document, schema: editor.store.schema });
                if (!parsed.ok) throw new Error('This saved canvas could not be opened. Your saved document has not been changed.');
                editor.store.loadStoreSnapshot(parsed.value.getStoreSnapshot());
                combinedPages = combineSavedPages(editor);
            } else {
                const firstPage = editor.getCurrentPageId();
                editor.updatePage({ id: firstPage, name: 'Blueprint' });
                let offset = 0;
                pages.forEach((page, index) => {
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
                        x: offset,
                        y: 0,
                        isLocked: true,
                        props: { assetId, w: page.width, h: page.height },
                    });
                    offset += page.width + 80;
                });
                editor.setCurrentPage(firstPage);
            }
            const view = ViewZod.safeParse(readLocal(`${storageKey}:view`));
            const page = view.success ? editor.getPages().find((item) => item.id === view.data.page) : null;
            let fitFrame: number | null = null;
            if (view.success && page && !combinedPages) {
                editor.setCurrentPage(page.id);
                editor.setCamera(view.data.camera);
            } else fitFrame = requestAnimationFrame(() => editor.zoomToFit());
            editor.clearHistory();
            editor.updateInstanceState({ isReadonly: true, isGridMode: true });
            editor.setCurrentTool('hand');
            setActiveEditor(editor);
            // Uploaded assets need durable storage. Keep file/URL insertion disabled until that exists.
            editor.registerExternalContentHandler('files', async () => {
                setError('Upload a blueprint in a new drawing session.');
            });
            editor.registerExternalContentHandler('url', async () => {
                setError('Pasting external assets is not supported in this workspace yet.');
            });
            if (!saved.document || document !== saved.document || combinedPages) model.changed(serializeDocument(editor));
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
                if (fitFrame !== null) cancelAnimationFrame(fitFrame);
                saveView();
            };
        } catch (cause) {
            editor.updateInstanceState({ isReadonly: true, isGridMode: true });
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
            <div
                className="relative min-h-0 flex-1"
                aria-label="Blueprint canvas"
                data-comment-mode={commentMode}
                tabIndex={-1}
                onPointerDownCapture={(event) => {
                    selectionGesture.current = null;
                    if (!(event.target instanceof Element) || event.target.closest('[data-comment-ui], input, textarea, select, [contenteditable="true"]'))
                        return;
                    if (event.button !== 0 || !event.isPrimary || !activeEditor || !event.target.closest('.tl-canvas')) return;
                    activeEditor.setCurrentTool('hand');
                    activeEditor.focus();
                    if (commentMode !== 'comment') {
                        const element = event.target.closest('[data-detected-object]');
                        const page = Number(element?.getAttribute('data-detected-page'));
                        const index = Number(element?.getAttribute('data-detected-index'));
                        const object =
                            element &&
                            Number.isInteger(index) &&
                            index >= 0 &&
                            drawing.detection?.pages.find((item) => item.page === page)?.detectedProperties[index]
                                ? { page, index }
                                : null;
                        selectionGesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, object };
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    const point = activeEditor.screenToPage({ x: event.clientX, y: event.clientY });
                    const hit = Array.from({ length: drawing.attachment?.pages ?? 0 }, (_, index) => index + 1)
                        .flatMap((page) => {
                            const shape = activeEditor.getShape(createShapeId(`blueprint-${page}`));
                            if (!shape || shape.type !== 'image') return [];
                            const local = activeEditor.getPointInShapeSpace(shape, point);
                            const x = local.x / shape.props.w;
                            const y = local.y / shape.props.h;
                            return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [{ page, x, y }] : [];
                        })
                        .at(-1);
                    if (hit) commentsModel.pointRequested(hit);
                }}
                onPointerMoveCapture={(event) => {
                    const gesture = selectionGesture.current;
                    if (gesture?.pointerId === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.moved = true;
                }}
                onPointerUpCapture={(event) => {
                    const gesture = selectionGesture.current;
                    selectionGesture.current = null;
                    if (
                        gesture?.pointerId === event.pointerId &&
                        !gesture.moved &&
                        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 5 &&
                        commentMode === 'default'
                    )
                        model.selected(gesture.object);
                }}
                onPointerCancelCapture={() => {
                    selectionGesture.current = null;
                }}
                onKeyDownCapture={(event) => {
                    if (!activeEditor || !(event.target instanceof Element)) return;
                    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
                    if (!event.target.closest('.tl-container')) return;
                    if (event.key === '+' || event.key === '=') activeEditor.zoomIn();
                    else if (event.key === '-') activeEditor.zoomOut();
                    else if (event.key === '0') activeEditor.zoomToFit();
                    else return;
                    event.preventDefault();
                    event.stopPropagation();
                }}
            >
                <CommentsContext.Provider value={{ drawing, model: commentsModel }}>
                    <DetectionContext.Provider value={{ drawing, model }}>
                        <Tldraw
                            store={store}
                            onMount={mount}
                            hideUi
                            initialState="hand"
                            licenseKey={config.TLDRAW_LICENSE_KEY}
                            options={{ maxPages: 1, camera: { isLocked: false, wheelBehavior: 'pan', panSpeed: 1, zoomSpeed: 1 } }}
                            components={{ OnTheCanvas: CanvasLayers, Grid: SquareGrid, Background: CanvasBackground }}
                        />
                    </DetectionContext.Provider>
                </CommentsContext.Provider>
                <DetectionControls drawing={drawing} model={model} />
            </div>
        </div>
    );
}

function SavedBlueprintCanvas({ drawing, userId }: Readonly<{ drawing: Drawing; userId: string }>) {
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

function EmptyBlueprintCanvas({ locked }: Readonly<{ locked: boolean }>) {
    const { resolvedTheme } = useTheme();
    const [editor, setEditor] = useState<Editor | null>(null);
    useEffect(() => {
        editor?.user.updateUserPreferences({ colorScheme: resolvedTheme === 'dark' ? 'dark' : 'light' });
    }, [editor, resolvedTheme]);
    return (
        <Tldraw
            hideUi
            components={{ Grid: SquareGrid, Background: CanvasBackground }}
            initialState="hand"
            licenseKey={config.TLDRAW_LICENSE_KEY}
            options={{ maxPages: 1, camera: { isLocked: locked, wheelBehavior: 'pan', panSpeed: 1, zoomSpeed: 1 } }}
            onMount={(instance) => {
                instance.updateInstanceState({ isReadonly: true, isGridMode: true });
                instance.user.updateUserPreferences({ colorScheme: resolvedTheme === 'dark' ? 'dark' : 'light' });
                instance.registerExternalContentHandler('files', async () => {});
                instance.registerExternalContentHandler('url', async () => {});
                setEditor(instance);
            }}
        />
    );
}

export default function BlueprintCanvas(props: Readonly<{ drawing: Drawing; userId: string }>) {
    return props.drawing.attachment && !props.drawing.attachment.hiddenFromCanvas ? (
        <SavedBlueprintCanvas {...props} />
    ) : (
        <EmptyBlueprintCanvas locked={!props.drawing.attachment} />
    );
}
