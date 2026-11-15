import { useEffect } from 'react';
import { useUnit } from 'effector-react';
import { getDetectedObjectColor, type Drawing, type DrawingTraceEvent } from '@repo/types';
import { Trace } from '@repo/design-system/components/ui/trace';
import { Button } from '@repo/design-system/components/ui/button';
import { $$drawings } from './model';
import { layerObjects } from './layout';
import { ProgressStep } from './progress-step';

type Message = Drawing['messages'][number];
function duration(start: string, end: string) {
    return `${Math.max(0, (Date.parse(end) - Date.parse(start)) / 1000).toFixed(1)}s`;
}

export function DrawingToolTrace({ drawing, message, busy }: Readonly<{ drawing: Drawing; message: Message; busy: boolean }>) {
    const { history, errors, connectTrace, selectObject } = useUnit({
        history: $$drawings.$traceEvents,
        errors: $$drawings.$traceErrors,
        connectTrace: $$drawings.connectTraceFx,
        selectObject: $$drawings.canvasSelectionRequested,
    });
    const key = `${drawing.id}/${message.id}`;
    const events = [...new Map([...(message.trace ?? []), ...(history[key] ?? [])].map((event) => [event.sequence, event])).values()].sort(
        (a, b) => a.sequence - b.sequence,
    );
    // Replay pending requests too: a refresh may occur before the canvas executes one.
    const after = 0;
    const pending = !message.answer && busy;
    useEffect(() => {
        if (!pending) return;
        let disposed = false;
        let disconnect: (() => void) | undefined;
        void connectTrace({ id: drawing.id, messageId: message.id, after }).then((close) => {
            if (disposed) close();
            else disconnect = close;
        });
        return () => {
            disposed = true;
            disconnect?.();
        };
    }, [drawing.id, message.id, pending, after, connectTrace]);
    if (!events.length && !pending) return null;
    const attempts = events.filter((event) => event.type === 'run_started');
    const objects = layerObjects(drawing.blueprints);
    return (
        <div aria-label="Tool activity" className="mb-3 min-w-0 space-y-2">
            {!attempts.length && (
                <p role="status" className="text-xs text-muted-foreground">
                    Starting answer…
                </p>
            )}
            {attempts.map((attempt, index) => {
                const activity = events.filter((event) => event.attemptId === attempt.attemptId);
                const ending = activity.find((event) => event.type === 'run_completed' || event.type === 'run_failed');
                const running = !ending && pending && index === attempts.length - 1;
                const failed = ending?.type === 'run_failed' || (!ending && !running) || (!message.answer && !busy);
                const calls = activity.filter((event): event is Extract<DrawingTraceEvent, { type: 'tool_started' }> => event.type === 'tool_started');
                const title = running ? 'Working…' : failed ? 'Answer interrupted' : `Completed ${calls.length} tool ${calls.length === 1 ? 'call' : 'calls'}`;
                return (
                    <ProgressStep
                        key={attempt.id}
                        defaultOpen
                        title={title}
                        status={running ? 'running' : failed ? 'error' : undefined}
                        detail={`${attempts.length > 1 ? `Attempt ${index + 1} · ` : ''}${ending ? duration(attempt.timestamp, ending.timestamp) : running ? 'In progress' : 'Interrupted'}`}
                    >
                        <Trace>
                            {calls.map((call) => {
                                const finished = activity.find(
                                    (event) => (event.type === 'tool_completed' || event.type === 'tool_failed') && event.callId === call.callId,
                                );
                                const status = finished?.type === 'tool_failed' || (!finished && !running) ? 'error' : !finished ? 'running' : undefined;
                                const blueprint = drawing.blueprints.find((sheet) => sheet.id === call.blueprintId);
                                const object =
                                    blueprint && call.entityId
                                        ? objects.find((item) => item.page === blueprint.pageNumber && item.property.id === call.entityId)
                                        : null;
                                const category =
                                    object?.property ?? (call.category ? objects.find((item) => item.property.label === call.category)?.property : null);
                                return (
                                    <ProgressStep
                                        key={call.id}
                                        title={`${object ? `Read ${object.name} details` : call.title}${blueprint ? ` · Sheet ${blueprint.pageNumber}` : call.blueprintId === null ? ' · All sheets' : ''}`}
                                        status={status}
                                        detail={finished ? duration(call.timestamp, finished.timestamp) : running ? 'Running' : 'Interrupted'}
                                        icon={
                                            category ? (
                                                <span className="size-2 shrink-0" style={{ backgroundColor: getDetectedObjectColor(category) }} />
                                            ) : undefined
                                        }
                                    >
                                        <p>
                                            {finished && 'summary' in finished
                                                ? finished.summary
                                                : running
                                                  ? 'Reading saved drawing data…'
                                                  : 'This action was interrupted.'}
                                        </p>
                                        {object && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                disabled={blueprint?.attachment.hiddenFromCanvas}
                                                title={
                                                    blueprint?.attachment.hiddenFromCanvas
                                                        ? 'Restore this sheet to the canvas to select its objects.'
                                                        : undefined
                                                }
                                                onClick={() => selectObject({ id: drawing.id, page: object.page, index: object.index })}
                                            >
                                                Show on drawing
                                            </Button>
                                        )}
                                    </ProgressStep>
                                );
                            })}
                        </Trace>
                        {running &&
                            calls.every((call) =>
                                activity.some((event) => (event.type === 'tool_completed' || event.type === 'tool_failed') && event.callId === call.callId),
                            ) && <p role="status">Preparing answer…</p>}
                        {ending?.type === 'run_failed' && <p>{ending.summary}</p>}
                        {!ending && failed && <p>Processing stopped before the answer completed. Retry to continue.</p>}
                    </ProgressStep>
                );
            })}
            {pending && errors[key] && (
                <p role="status" className="text-xs text-muted-foreground">
                    {errors[key]}
                </p>
            )}
        </div>
    );
}
