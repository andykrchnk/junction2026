import { layoutPages } from './layout';
import { AnnotationPicker } from './drawing-annotation';
import { useEffect, useState, useId, useRef, useMemo } from 'react';
import { useUnit } from 'effector-react';
import { useReducedMotion } from 'motion/react';
import { useTheme } from 'next-themes';
import { useHotkeys } from 'react-hotkeys-hook';
import { CanvasStateZod, type Drawing } from '@repo/types';
import {
    AssetRecordType,
    Box,
    createTLStore,
    createShapeId,
    getSnapshot,
    parseTldrawJsonFile,
    Tldraw,
    type Editor,
    type TLShape,
    type TldrawProps,
    type TLAssetStore,
    type TLGridProps,
} from 'tldraw';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import { Button } from '@repo/design-system/components/ui/button';
import { authenticatedFetch } from '@/shared/auth';
import { config } from '@/shared/config';
import { type CanvasModel, type LoadedCanvas } from './canvas/model';
import { readLocal, ViewZod, writeLocal } from './canvas-storage';
import { DetectionCanvasLayer, DetectionContext } from './detection-layer';
import { CommentsContext, CommentCanvasLayer } from './comment-layer';
import { type CommentsModel } from './canvas/comments-model';
import 'tldraw/tldraw.css';
import './blueprint-canvas.css';

const blueprintVisibility = (shape: TLShape) => (shape.meta.blueprintHidden === true ? 'hidden' : 'inherit');

const canvasOptions: TldrawProps['options'] = { maxPages: 1, camera: { isLocked: false, wheelBehavior: 'pan', panSpeed: 1, zoomSpeed: 1 } };

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

async function prepareAttachment(drawing: Drawing): Promise<BlueprintPage[]> {
    const response = await authenticatedFetch(`${config.API_URL}/api/drawings/${drawing.id}/file?page=${drawing.blueprints[0]?.pageNumber ?? 1}`);
    if (!response.ok) throw new Error('Could not load the blueprint. Try opening it again.');
    const blob = await response.blob();
    if (drawing.blueprints[0]?.attachment.mediaType !== 'application/pdf') {
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

async function preparePages(drawing: Drawing): Promise<BlueprintPage[]> {
    const pages: BlueprintPage[] = [];
    try {
        for (const id of new Set(drawing.blueprints.map((item) => item.attachment.id))) {
            pages.push(...(await prepareAttachment({ ...drawing, blueprints: drawing.blueprints.filter((item) => item.attachment.id === id) })));
        }
        return pages;
    } catch (error) {
        pages.forEach((page) => URL.revokeObjectURL(page.src));
        throw error;
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
    commentsModel,
}: Readonly<{
    drawing: Drawing;
    pages: BlueprintPage[];
    saved: LoadedCanvas;
    recovery: LoadedCanvas | null;
    storageKey: string;
    model: CanvasModel;
    commentsModel: CommentsModel;
}>) {
    const { resolvedTheme } = useTheme();
    const { status, commentMode, openCommentId, selectedObject, draftComment } = useUnit({
        status: model.$status,
        commentMode: commentsModel.$mode,
        openCommentId: commentsModel.$openId,
        draftComment: commentsModel.$draft,
        selectedObject: model.$selected,
    });
    const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!activeEditor) return;
        for (const blueprint of drawing.blueprints) {
            const shape = activeEditor.getShape(createShapeId(`blueprint-${blueprint.pageNumber}`));
            const hidden = Boolean(blueprint.attachment.hiddenFromCanvas);
            if (shape && shape.meta.blueprintHidden !== hidden) activeEditor.store.put([{ ...shape, meta: { ...shape.meta, blueprintHidden: hidden } }]);
        }
    }, [activeEditor, drawing.blueprints]);
    const selectionGesture = useRef<SelectionGesture | null>(null);
    const focus = useUnit(model.$focus);
    const reducedMotion = useReducedMotion();
    const sheetFocus = useUnit(model.$sheetFocus);
    useEffect(() => {
        if (!activeEditor || !sheetFocus) return;
        const bounds = activeEditor.getShapePageBounds(createShapeId(`blueprint-${sheetFocus.page}`));
        if (bounds) activeEditor.zoomToBounds(bounds.clone().expandBy(48), { animation: { duration: reducedMotion ? 0 : 350 } });
    }, [activeEditor, sheetFocus, reducedMotion]);
    useEffect(() => {
        if (!activeEditor || !focus) return;
        const page = layoutPages(drawing.blueprints).find((page) => page.page === focus.object.page);
        const property = page?.detectedProperties[focus.object.index];
        const shape = activeEditor.getShape(createShapeId(`blueprint-${focus.object.page}`));
        if (!page || !property || !shape || shape.type !== 'image') return;
        const geometry = property.geometry;
        const coordinates =
            geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
        const transform = activeEditor.getShapePageTransform(shape);
        const points = coordinates.map(([x, y]) => transform.applyToPoint({ x: (x * shape.props.w) / page.width, y: (y * shape.props.h) / page.height }));
        if (points.length) activeEditor.zoomToBounds(Box.FromPoints(points).expandBy(32), { targetZoom: 2, animation: { duration: reducedMotion ? 0 : 350 } });
    }, [activeEditor, focus, drawing.blueprints, reducedMotion]);
    useHotkeys(
        'c',
        (event) => {
            if (!activeEditor || event.repeat) return;
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
            commentsModel.modeChanged(commentMode === 'comment' ? 'default' : 'comment');
            activeEditor.setCurrentTool('hand');
            activeEditor.focus();
            event.stopPropagation();
        },
        { enabled: activeEditor !== null, preventDefault: true, eventListenerOptions: { capture: true } },
        [activeEditor, commentsModel, commentMode],
    );
    useHotkeys(
        'esc',
        (event) => {
            if (event.repeat || event.defaultPrevented) return;
            const target = event.target instanceof Element ? event.target : null;
            const commentUi = target?.closest('[data-comment-ui]');
            // Portaled menus/dialogs and text editors own Escape before canvas selection.
            if (!commentUi && target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
            if (!commentUi && openCommentId === null && target?.closest('input, textarea, select, [contenteditable="true"]')) return;
            if (openCommentId === null && commentMode === 'default' && document.querySelector('[data-detected-object][data-popup-open]')) return;
            event.preventDefault();
            event.stopPropagation();
            selectionGesture.current = null;
            if (draftComment && (openCommentId === null || openCommentId === draftComment.id)) commentsModel.draftCancelled();
            else if (openCommentId !== null) commentsModel.openChanged(null);
            else if (commentMode !== 'default') commentsModel.modeChanged('default');
            else model.selected(null);
        },
        {
            enabled: activeEditor !== null && (commentMode !== 'default' || openCommentId !== null || selectedObject !== null),
            enableOnFormTags: true,
            enableOnContentEditable: true,
            eventListenerOptions: { capture: true },
        },
        [activeEditor, commentsModel, openCommentId, commentMode, model, draftComment],
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
            }
            {
                const firstPage = editor.getCurrentPageId();
                editor.updatePage({ id: firstPage, name: 'Blueprint' });
                let offset = Math.max(0, ...editor.getCurrentPageShapes().map((shape) => (editor.getShapePageBounds(shape)?.maxX ?? 0) + 80));
                pages.forEach((page, index) => {
                    if (editor.getShape(createShapeId(`blueprint-${index + 1}`))) return;
                    combinedPages = true;
                    const assetId = AssetRecordType.createId(`blueprint-${drawing.blueprints[0]?.attachment.id}-${index + 1}`);
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
                setError('Add documents using the Blueprints menu.');
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
                            layoutPages(drawing.blueprints).find((item) => item.page === page)?.detectedProperties[index]
                                ? { page, index }
                                : null;
                        selectionGesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, object };
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    const element = event.target.closest('[data-detected-object]');
                    const pageNumber = Number(element?.getAttribute('data-detected-page'));
                    const index = Number(element?.getAttribute('data-detected-index'));
                    const property =
                        element && Number.isInteger(index) && index >= 0
                            ? layoutPages(drawing.blueprints).find((page) => page.page === pageNumber)?.detectedProperties[index]
                            : null;
                    if (property?.type === 'room' || property?.type === 'icon') {
                        commentsModel.placementRequested({
                            application: 'entity',
                            page: pageNumber,
                            roomId: property.type === 'room' ? property.id : null,
                            fixtureId: property.type === 'icon' ? property.id : null,
                        });
                        return;
                    }
                    const point = activeEditor.screenToPage({ x: event.clientX, y: event.clientY });
                    const hit = drawing.blueprints
                        .filter((item) => !item.attachment.hiddenFromCanvas)
                        .map((blueprint) => blueprint.pageNumber)
                        .flatMap((page) => {
                            const shape = activeEditor.getShape(createShapeId(`blueprint-${page}`));
                            if (!shape || shape.type !== 'image') return [];
                            const local = activeEditor.getPointInShapeSpace(shape, point);
                            const x = local.x / shape.props.w;
                            const y = local.y / shape.props.h;
                            return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [{ page, x, y }] : [];
                        })
                        .at(-1);
                    if (hit) commentsModel.placementRequested({ ...hit, application: 'point' });
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
                        commentMode !== 'comment'
                    )
                        if (event.shiftKey && gesture.object) model.selectionToggled(gesture.object);
                        else model.selected(gesture.object);
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
                <CommentsContext.Provider
                    value={{
                        drawing: { ...drawing, blueprints: drawing.blueprints.filter((item) => !item.attachment.hiddenFromCanvas) },
                        model: commentsModel,
                    }}
                >
                    <DetectionContext.Provider
                        value={{ drawing: { ...drawing, blueprints: drawing.blueprints.filter((item) => !item.attachment.hiddenFromCanvas) }, model }}
                    >
                        <Tldraw
                            getShapeVisibility={blueprintVisibility}
                            store={store}
                            onMount={mount}
                            hideUi
                            initialState="hand"
                            licenseKey={config.TLDRAW_LICENSE_KEY}
                            options={canvasOptions}
                            components={{ OnTheCanvas: CanvasLayers, Grid: SquareGrid, Background: CanvasBackground }}
                        />
                    </DetectionContext.Provider>
                </CommentsContext.Provider>
                {activeEditor && <AnnotationPicker drawing={drawing} canvas={model} model={commentsModel} editor={activeEditor} />}
            </div>
        </div>
    );
}

function SavedBlueprintCanvas({
    drawing,
    userId,
    model,
    commentsModel,
}: Readonly<{ drawing: Drawing; userId: string; model: CanvasModel; commentsModel: CommentsModel }>) {
    const storageKey = `junction:canvas:${userId}:${drawing.id}`;
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
        // The parent remounts this loader when the blueprint identities change.
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
    return <CanvasEditor commentsModel={commentsModel} key={drawing.id} drawing={drawing} model={model} storageKey={storageKey} {...preparation} />;
}

function EmptyBlueprintCanvas({ locked }: Readonly<{ locked: boolean }>) {
    const options = useMemo<TldrawProps['options']>(
        () => ({ maxPages: 1, camera: { isLocked: locked, wheelBehavior: 'pan', panSpeed: 1, zoomSpeed: 1 } }),
        [locked],
    );
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
            options={options}
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

export default function BlueprintCanvas(props: Readonly<{ drawing: Drawing; userId: string; model: CanvasModel; commentsModel: CommentsModel }>) {
    return props.drawing.blueprints.some((blueprint) => !blueprint.attachment.hiddenFromCanvas) ? (
        <SavedBlueprintCanvas key={props.drawing.blueprints.map((item) => item.id).join(',')} {...props} />
    ) : (
        <EmptyBlueprintCanvas locked={!props.drawing.blueprints.length} />
    );
}
