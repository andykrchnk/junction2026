import { createContext, useContext, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUnit } from 'effector-react';
import { createShapeId, useEditor, useValue } from 'tldraw';
import type { Drawing, ScanComment } from '@repo/types';
import { Button } from '@repo/design-system/components/ui/button';
import { ScrollArea } from '@repo/design-system/components/ui/scroll-area';
import { Textarea } from '@repo/design-system/components/ui/textarea';
import { SurfaceProvider } from '@repo/design-system/lib/surface-context';
import { surfaceClasses } from '@repo/design-system/lib/surface-classes';
import { Trash2, X } from '@repo/design-system/lib/icons-remix';
import { queryClient, trpc } from '@/shared/trpc';
import type { CommentsModel } from './canvas/comments-model';

type CommentsContextValue = Readonly<{ drawing: Drawing; model: CommentsModel }>;
export const CommentsContext = createContext<CommentsContextValue | null>(null);

// Stop wheel bubbling before tldraw's native canvas listener, while preserving native scrolling.
function isolatePopoverWheel(element: HTMLElement | null) {
    if (!element) return;
    const stopWheel = (event: WheelEvent) => event.stopPropagation();
    element.addEventListener('wheel', stopWheel, { passive: true });
    return () => element.removeEventListener('wheel', stopWheel);
}

function commentPoint(params: { comment: ScanComment; drawing: Drawing }) {
    const { comment, drawing } = params;
    if (comment.application === 'point') return { x: comment.x, y: comment.y };
    if (comment.application === 'area') {
        return { x: (comment.boundaries.left + comment.boundaries.right) / 2, y: (comment.boundaries.top + comment.boundaries.bottom) / 2 };
    }
    const page = drawing.detection?.pages.find((candidate) => candidate.page === comment.page);
    const property = page?.detectedProperties.find((candidate, index) =>
        candidate.type === 'room'
            ? comment.roomId === `${comment.page}:room:${index}`
            : candidate.type === 'icon' && comment.fixtureId === `${comment.page}:fixture:${index}`,
    );
    if (!page || !property) return null;
    // Without a supplied centroid/bounds, anchor to a real exterior vertex.
    const geometryAnchor =
        property.geometry.type === 'Point'
            ? property.geometry.coordinates
            : property.geometry.type === 'Polygon'
              ? property.geometry.coordinates[0]?.[0]
              : property.geometry.coordinates[0]?.[0]?.[0];
    const centroid =
        property.centroid ?? (property.bbox ? [(property.bbox[0] + property.bbox[2]) / 2, (property.bbox[1] + property.bbox[3]) / 2] : geometryAnchor);
    if (!centroid) return null;
    return { x: centroid[0] / page.width, y: centroid[1] / page.height };
}

function CommentLayer({ drawing, model }: CommentsContextValue) {
    const editor = useEditor();
    const { openId, draft, error, creating, deleting, deleteError } = useUnit({
        openId: model.$openId,
        draft: model.$draft,
        error: model.$error,
        creating: model.$creating,
        deleting: model.$deleting,
        deleteError: model.$deleteError,
    });
    const { data: comments = [], error: loadError } = useQuery({
        ...trpc.drawings.comments.list.queryOptions({ drawingId: drawing.id }),
        initialData: drawing.comments,
    });
    const persistedCommentIds = JSON.stringify(
        drawing.comments
            ?.filter((comment) => !comment.deletedAt)
            .map((comment) => comment.id)
            .sort() ?? [],
    );
    const ppmComplete = drawing.ppmCandidates !== null && drawing.ppmCandidates !== undefined;
    useEffect(() => {
        void queryClient.invalidateQueries(trpc.drawings.comments.list.queryFilter({ drawingId: drawing.id }));
    }, [drawing.id, persistedCommentIds, ppmComplete]);
    const zoom = useValue('comment zoom', () => editor.getZoomLevel(), [editor]);
    const viewport = useValue('comment viewport', () => editor.getViewportScreenBounds(), [editor]);
    const entries = useValue(
        'comment anchors',
        () => {
            const markers: ScanComment[] = [
                ...comments.filter((comment) => comment.id !== draft?.id && !comment.deletedAt),
                ...(draft ? [{ ...draft, source: 'user' as const, createdAt: '', application: 'point' as const, type: 'comment' as const }] : []),
            ];
            return markers.flatMap((comment) => {
                const point = commentPoint({ comment, drawing });
                const shape = editor.getShape(createShapeId(`blueprint-${comment.page}`));
                if (!point || !shape || shape.type !== 'image') return [];
                const transform = editor.getShapePageTransform(shape);
                if (!transform) return [];
                const localX = point.x * shape.props.w;
                const localY = point.y * shape.props.h;
                const x = transform.a * localX + transform.c * localY + transform.e;
                const y = transform.b * localX + transform.d * localY + transform.f;
                return [{ comment, x, y, screen: editor.pageToScreen({ x, y }) }];
            });
        },
        [editor, comments, draft, drawing],
    );

    return (
        <div style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none', zIndex: 200000 }}>
            {loadError && (
                <p role="alert" className="sr-only">
                    Could not load comments. Reopen the drawing to retry.
                </p>
            )}
            {entries.map(({ comment, x, y, screen }) => {
                const isOpen = openId === comment.id;
                const isDraft = draft?.id === comment.id;
                const isAnnotation = comment.type === 'annotation';
                const width = Math.min(288, Math.max(180, viewport.w - 24));
                const maxHeight = Math.min(360, Math.max(120, viewport.h - 24));
                const flipLeft = screen.x + 16 + width > viewport.x + viewport.w;
                const flipUp = screen.y + 12 + maxHeight > viewport.y + viewport.h;
                return (
                    <div
                        key={comment.id}
                        data-comment-ui="true"
                        style={{
                            position: 'absolute',
                            zIndex: isOpen ? 1 : 0,
                            transformOrigin: '0 0',
                            transform: `translate(${x}px, ${y}px) scale(${1 / zoom})`,
                            pointerEvents: 'auto',
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        <button
                            type="button"
                            aria-label={`${isDraft ? 'New comment' : isAnnotation ? 'Annotation' : 'Comment'}, sheet ${comment.page}`}
                            aria-expanded={isOpen}
                            onClick={() => model.openChanged(comment.id)}
                            className="group absolute -left-3 -top-3 flex size-6 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                            <svg
                                width={8}
                                height={8}
                                viewBox="0 0 8 8"
                                className={`${isAnnotation ? 'text-yellow-600' : 'text-green-600'} transition-transform duration-150 group-hover:scale-200 motion-reduce:transition-none`}
                                aria-hidden="true"
                            >
                                <circle cx={4} cy={4} r={4} fill="currentColor" />
                            </svg>
                        </button>
                        {isOpen && (
                            <SurfaceProvider value={2}>
                                <section
                                    ref={isolatePopoverWheel}
                                    role="dialog"
                                    aria-label={isDraft ? 'New comment' : isAnnotation ? 'Annotation' : 'Comment'}
                                    className={`${surfaceClasses(2)} absolute flex flex-col gap-3 overflow-hidden rounded p-3 text-sm text-foreground`}
                                    style={{
                                        left: flipLeft ? -width - 16 : 16,
                                        top: flipUp ? -12 : 12,
                                        transform: flipUp ? 'translateY(-100%)' : undefined,
                                        width,
                                        maxHeight,
                                    }}
                                >
                                    <div className="flex shrink-0 items-center justify-between gap-3">
                                        <p className="text-xs font-medium">
                                            {isDraft
                                                ? 'New comment'
                                                : isAnnotation
                                                  ? comment.source === 'ppm'
                                                      ? 'Unverified scale estimate'
                                                      : 'Annotation'
                                                  : 'Comment'}{' '}
                                            · Sheet {comment.page}
                                        </p>
                                        <div className="flex shrink-0 items-center gap-1">
                                            {comment.type === 'comment' && (
                                                <Button
                                                    size="icon-compact"
                                                    variant="ghost"
                                                    aria-label="Delete comment"
                                                    disabled={creating || deleting}
                                                    loading={deleting}
                                                    onClick={() => model.deleteRequested(comment.id)}
                                                >
                                                    <Trash2 />
                                                </Button>
                                            )}
                                            <Button size="icon-compact" variant="ghost" aria-label="Close comment" onClick={() => model.openChanged(null)}>
                                                <X />
                                            </Button>
                                        </div>
                                    </div>
                                    <ScrollArea
                                        role="region"
                                        aria-label="Comment content"
                                        className="min-h-0"
                                        style={{ maxHeight: Math.max(36, maxHeight - 84) }}
                                        viewportClassName="max-h-[inherit] overscroll-contain"
                                        onKeyDown={(event) => {
                                            if (event.key !== 'Escape') event.stopPropagation();
                                        }}
                                    >
                                        {deleteError?.id === comment.id && (
                                            <p role="alert" className="mb-2 text-xs text-destructive">
                                                {deleteError.message}
                                            </p>
                                        )}
                                        {isDraft ? (
                                            <form
                                                onSubmit={(event) => {
                                                    event.preventDefault();
                                                    model.saveRequested();
                                                }}
                                            >
                                                <Textarea
                                                    aria-label="Comment text"
                                                    value={draft.text}
                                                    maxLength={6000}
                                                    rows={4}
                                                    disabled={creating}
                                                    onChange={(event) => model.draftChanged(event.currentTarget.value)}
                                                />
                                                {error && (
                                                    <p role="alert" className="mt-2 text-xs text-destructive">
                                                        {error}
                                                    </p>
                                                )}
                                                <Button
                                                    className="mt-3"
                                                    type="submit"
                                                    size="compact"
                                                    disabled={!draft.text.trim() || creating || deleting}
                                                    loading={creating}
                                                >
                                                    {error ? 'Retry save' : 'Save comment'}
                                                </Button>
                                            </form>
                                        ) : (
                                            <p className="whitespace-pre-wrap break-words">{comment.text}</p>
                                        )}
                                    </ScrollArea>
                                </section>
                            </SurfaceProvider>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export function CommentCanvasLayer() {
    const context = useContext(CommentsContext);
    return context ? <CommentLayer {...context} /> : null;
}
