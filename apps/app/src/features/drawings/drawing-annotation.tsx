import { useEffect } from 'react';
import { layoutPages } from './layout';
import { useUnit } from 'effector-react';
import { createShapeId, useValue, type Editor } from 'tldraw';
import type { Drawing } from '@repo/types';
import { Button } from '@repo/design-system/components/ui/button';
import { Textarea } from '@repo/design-system/components/ui/textarea';
import { Cursor } from '@repo/design-system/lib/icons-remix';
import type { CommentsModel } from './canvas/comments-model';
import type { CanvasModel } from './canvas/model';

export function AnnotateButton({ model, disabled }: Readonly<{ model: CommentsModel; disabled: boolean }>) {
    const mode = useUnit(model.$mode);
    return (
        <Button
            size="compact"
            variant="ghost"
            leadingIcon={Cursor}
            disabled={disabled}
            active={mode === 'annotate'}
            onClick={() => model.modeChanged(mode === 'annotate' ? 'default' : 'annotate')}
        >
            Annotate
        </Button>
    );
}

export function AnnotationPicker({
    drawing,
    canvas,
    model,
    editor,
}: Readonly<{ drawing: Drawing; canvas: CanvasModel; model: CommentsModel; editor: Editor }>) {
    const { selection, mode, text, sending, error } = useUnit({
        selection: canvas.$selection,
        mode: model.$mode,
        text: model.$annotationText,
        sending: model.$annotationSending,
        error: model.$annotationError,
    });
    useEffect(() => {
        if (mode === 'annotate') canvas.selected(null);
    }, [mode, canvas]);
    const selected = selection.at(-1) ?? null;
    const pages = layoutPages(drawing.blueprints.filter((blueprint) => !blueprint.attachment.hiddenFromCanvas));
    const page = selected ? pages.find((page) => page.page === selected.page) : null;
    const property = selected ? page?.detectedProperties[selected.index] : null;
    const anchor = useValue(
        'annotation anchor',
        () => {
            if (!selected || !property) return null;
            const shape = editor.getShape(createShapeId(`blueprint-${selected.page}`));
            if (!page || !shape || shape.type !== 'image') return null;
            const transform = editor.getShapePageTransform(shape);
            const points =
                property.geometry.type === 'Point'
                    ? [property.geometry.coordinates]
                    : property.geometry.type === 'Polygon'
                      ? property.geometry.coordinates.flat()
                      : property.geometry.coordinates.flat(2);
            if (!points.length) return null;
            const bounds = editor.getViewportScreenBounds();
            const screen = points.map(([x, y]) =>
                editor.pageToScreen(transform.applyToPoint({ x: (x * shape.props.w) / page.width, y: (y * shape.props.h) / page.height })),
            );
            const left = Math.min(...screen.map((p) => p.x)) - bounds.x;
            const right = Math.max(...screen.map((p) => p.x)) - bounds.x;
            const top = Math.min(...screen.map((p) => p.y)) - bounds.y;
            return {
                x: Math.max(12, Math.min(right + 12 + 288 <= bounds.w ? right + 12 : left - 300, bounds.w - 300)),
                y: Math.max(12, Math.min(top, bounds.h - 220)),
            };
        },
        [editor, selected, property, page],
    );
    if (mode !== 'annotate') return null;
    if (!property || !selected || !anchor)
        return (
            <div
                role="status"
                className="pointer-events-none absolute bottom-4 left-1/2 z-[300] -translate-x-1/2 border bg-card px-4 py-2 text-sm text-muted-foreground"
            >
                Click an element to annotate · Esc to cancel
            </div>
        );
    const sendAnnotation = () => {
        if (text.trim() && !sending) model.annotationSent({ ...selected, property, text: text.trim() });
    };
    return (
        <section
            data-comment-ui
            aria-label="Annotate selection"
            style={{ left: anchor.x, top: anchor.y }}
            className="absolute z-[300] w-72 max-w-[calc(100%-1.5rem)] space-y-3 border bg-card p-4 text-sm shadow-lg"
        >
            <Textarea
                autoFocus
                disabled={sending}
                aria-label="Annotation message"
                placeholder="Ask about this element…"
                value={text}
                maxLength={4000}
                onChange={(event) => model.annotationTextChanged(event.currentTarget.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!event.repeat) sendAnnotation();
                    }
                }}
            />
            {error && (
                <p role="alert" className="text-destructive text-xs">
                    {error}
                </p>
            )}
            <div className="flex items-center justify-between gap-3">
                <Button size="compact" variant="ghost" onClick={() => model.modeChanged('default')}>
                    Cancel
                </Button>
                <Button
                    size="compact"
                    disabled={!text.trim() || sending}
                    onClick={sendAnnotation}
                    aria-keyshortcuts="Shift+Enter"
                    title="Send to chat (Shift + Enter)"
                >
                    Send to chat
                </Button>
            </div>
        </section>
    );
}

export function AnnotationChatNavigation({ model, onSelectChat }: Readonly<{ model: CommentsModel; onSelectChat: (tab: number) => void }>) {
    const sending = useUnit(model.$annotationSending);
    useEffect(() => {
        if (sending) onSelectChat(0);
    }, [sending, onSelectChat]);
    return null;
}
