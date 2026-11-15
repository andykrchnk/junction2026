import { useEffect, useRef } from 'react';
import { useUnit } from 'effector-react';
import { useReducedMotion } from 'motion/react';
import { Box, createShapeId, type Editor } from 'tldraw';
import type { Drawing } from '@repo/types';
import { Button } from '@repo/design-system/components/ui/button';
import { $$drawings } from './model';
import { layoutPages } from './layout';
import type { CanvasModel, ObjectSelection } from './canvas/model';

// Browser actions are ephemeral canvas state; their receipts belong to the server's answer attempt.
export function CanvasAgentActions({ drawing, editor, model }: Readonly<{ drawing: Drawing; editor: Editor | null; model: CanvasModel }>) {
    const {
        history,
        outgoing,
        activity,
        acknowledge,
        selectionRequestId,
        selection,
        apply,
        clear,
        visibility,
        hiddenObjects,
        visibilityAction,
        changeVisibility,
        showAll,
    } = useUnit({
        history: $$drawings.$traceEvents,
        outgoing: $$drawings.$outgoing,
        activity: $$drawings.$activity,
        acknowledge: $$drawings.acknowledgeCanvasActionFx,
        selectionRequestId: model.$agentSelectionRequestId,
        selection: model.$selection,
        apply: model.agentSelectionApplied,
        clear: model.agentSelectionCleared,
        visibility: model.$visibility,
        hiddenObjects: model.$hiddenObjects,
        visibilityAction: model.$agentVisibility,
        changeVisibility: model.agentVisibilityApplied,
        showAll: model.allObjectsShown,
    });
    const banner = useRef<HTMLDivElement>(null);
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const handled = useRef(new Set<string>());
    const reducedMotion = useReducedMotion();
    useEffect(() => {
        if (!editor || (!drawing.busy && !(activity[drawing.id] > 0))) return;
        const optimistic = outgoing[drawing.id];
        const messages = optimistic && !drawing.messages.some((message) => message.id === optimistic.id) ? [...drawing.messages, optimistic] : drawing.messages;
        for (const message of messages) {
            if (message.answer) continue;
            const events = [
                ...new Map([...(message.trace ?? []), ...(history[`${drawing.id}/${message.id}`] ?? [])].map((event) => [event.sequence, event])).values(),
            ].sort((a, b) => a.sequence - b.sequence);
            const attempt = events.filter((event) => event.type === 'run_started').at(-1);
            if (!attempt || events.some((event) => event.attemptId === attempt.attemptId && (event.type === 'run_completed' || event.type === 'run_failed')))
                continue;
            for (const request of events) {
                if (
                    (request.type !== 'highlight_requested' && request.type !== 'visibility_requested') ||
                    request.attemptId !== attempt.attemptId ||
                    request.acknowledgment ||
                    handled.current.has(request.id) ||
                    Date.parse(request.expiresAt) <= Date.now()
                )
                    continue;
                handled.current.add(request.id);
                const pages = layoutPages(drawing.blueprints);
                const objects: ObjectSelection[] = [];
                const points = [];
                let available = true;
                for (const reference of request.items) {
                    const blueprint = drawing.blueprints.find((sheet) => sheet.id === reference.blueprintId);
                    const page = pages.find((sheet) => sheet.page === blueprint?.pageNumber);
                    const index = page?.detectedProperties.findIndex((property) => property.id === reference.entityId) ?? -1;
                    const property = page?.detectedProperties[index];
                    const shape = blueprint ? editor.getShape(createShapeId(`blueprint-${blueprint.pageNumber}`)) : null;
                    if (
                        !blueprint ||
                        !page ||
                        !property ||
                        !shape ||
                        shape.type !== 'image' ||
                        blueprint.attachment.hiddenFromCanvas ||
                        shape.meta.blueprintHidden ||
                        (request.type === 'highlight_requested' && (!visibility[property.type] || hiddenObjects.includes(`${page.page}:${index}`)))
                    ) {
                        available = false;
                        break;
                    }
                    objects.push({ page: page.page, index });
                    const coordinates =
                        property.geometry.type === 'Point'
                            ? [property.geometry.coordinates]
                            : property.geometry.type === 'Polygon'
                              ? property.geometry.coordinates.flat()
                              : property.geometry.coordinates.flat(2);
                    const transform = editor.getShapePageTransform(shape);
                    points.push(
                        ...coordinates.map(([x, y]) => transform.applyToPoint({ x: (x * shape.props.w) / page.width, y: (y * shape.props.h) / page.height })),
                    );
                }
                const scopePages =
                    request.type === 'visibility_requested'
                        ? request.blueprintIds.flatMap((id) => drawing.blueprints.filter((sheet) => sheet.id === id).map((sheet) => sheet.pageNumber))
                        : [];
                if (
                    request.type === 'visibility_requested' &&
                    (scopePages.length !== request.blueprintIds.length ||
                        request.blueprintIds.some((id) => {
                            const blueprint = drawing.blueprints.find((sheet) => sheet.id === id);
                            const shape = blueprint ? editor.getShape(createShapeId(`blueprint-${blueprint.pageNumber}`)) : null;
                            return !blueprint || blueprint.attachment.hiddenFromCanvas || !shape || shape.meta.blueprintHidden;
                        }))
                )
                    available = false;
                const expected = available && (objects.length > 0 || (request.type === 'visibility_requested' && request.mode === 'reset'));
                const allObjects = pages.flatMap((page) => page.detectedProperties.map((property, index) => ({ page: page.page, index, type: property.type })));
                if (expected) {
                    if (request.type === 'highlight_requested') apply({ requestId: request.id, objects });
                    else changeVisibility({ requestId: request.id, mode: request.mode, scopePages, targets: objects, objects: allObjects });
                    if (request.focus && points.length)
                        editor.zoomToBounds(Box.FromPoints(points).expandBy(48), { targetZoom: 2, animation: { duration: reducedMotion ? 0 : 350 } });
                }
                // Confirm the rendered selection/visibility, rather than receipt of a command.
                const started = performance.now();
                const confirm = () => {
                    if (!mounted.current) return;
                    const current = banner.current;
                    const rendered = current?.parentElement?.querySelectorAll<SVGElement>('[data-detected-object]') ?? [];
                    const key = (object: { page: number; index: number }) => `${object.page}:${object.index}`;
                    const visible = new Set(Array.from(rendered).map((element) => `${element.dataset.detectedPage}:${element.dataset.detectedIndex}`));
                    const targets = new Set(objects.map(key));
                    let applied = false;
                    if (expected && current) {
                        if (request.type === 'highlight_requested')
                            applied =
                                current.dataset.selectionRequestId === request.id &&
                                Array.from(rendered).filter((element) => element.getAttribute('aria-pressed') === 'true').length === objects.length;
                        else if (current.dataset.visibilityRequestId === request.id) {
                            const scoped = allObjects.filter((object) => scopePages.includes(object.page));
                            applied =
                                request.mode === 'hide'
                                    ? objects.every((object) => !visible.has(key(object)))
                                    : request.mode === 'show'
                                      ? objects.every((object) => visible.has(key(object)))
                                      : scoped.every((object) => visible.has(key(object)) === (request.mode === 'reset' || targets.has(key(object))));
                        }
                    }
                    if (expected && !applied && performance.now() - started < 4000) {
                        window.setTimeout(confirm, 50);
                        return;
                    }
                    void acknowledge({ id: drawing.id, messageId: message.id, eventId: request.id, status: applied ? 'applied' : 'failed' })
                        .then((receipt) => {
                            if (receipt.status === 'failed' && banner.current?.dataset.selectionRequestId === request.id) clear();
                        })
                        .catch(() => {
                            // Failure to acknowledge leaves the tool unconfirmed on the backend.
                            if (banner.current?.dataset.selectionRequestId === request.id) clear();
                        });
                };
                window.setTimeout(confirm, request.focus && !reducedMotion ? 400 : 0);
            }
        }
    }, [drawing, editor, history, outgoing, activity, acknowledge, apply, clear, visibility, hiddenObjects, changeVisibility, reducedMotion]);
    return (
        <div
            ref={banner}
            data-selection-request-id={selectionRequestId ?? undefined}
            data-visibility-request-id={visibilityAction?.requestId}
            className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 text-xs"
        >
            {selectionRequestId && selection.length > 0 && (
                <div aria-label="Agent selection" className="flex items-center gap-3 border bg-card px-3 py-2 shadow-sm">
                    <span role="status">{selection.length} objects selected</span>
                    <Button size="sm" variant="ghost" onClick={() => clear()}>
                        Clear selection
                    </Button>
                </div>
            )}
            {visibilityAction && visibilityAction.mode !== 'reset' && (
                <div aria-label="Element visibility" className="flex items-center gap-3 border bg-card px-3 py-2 shadow-sm">
                    <span role="status">Elements filtered</span>
                    <Button size="sm" variant="ghost" onClick={() => showAll()}>
                        Show all elements
                    </Button>
                </div>
            )}
        </div>
    );
}
