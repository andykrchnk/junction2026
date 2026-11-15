import { getDetectedObjectColor, hasDetailedEntityDescription, type Blueprint, type Drawing, type LayoutRoom, type LayoutFixture } from '@repo/types';
import { useEffect, useState } from 'react';
import { useUnit } from 'effector-react';
import { BrandLogo } from '@repo/design-system/components/ui/brand-logo';
import { Button } from '@repo/design-system/components/ui/button';
import {
    Trace,
    TraceLine,
    TraceTitle,
    TraceIcon,
    TraceCollapsible,
    TraceCollapsibleTrigger,
    TraceCollapsibleContent,
} from '@repo/design-system/components/ui/trace';
import { layerObjects } from './layout';
import { $$drawings } from './model';
import { ProgressStep } from './progress-step';
import { DrawingScale } from './drawing-scale';
import { DrawingNotes } from './drawing-notes';
type LayerObject = ReturnType<typeof layerObjects>[number];

const stageLabels = {
    inference: 'Detecting rooms and fixtures',
    misc: 'Reading drawing notes',
    entities: 'Reviewing rooms and fixtures',
    ppm: 'Estimating scale',
};

function elapsedTime(milliseconds: number): string {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function ObjectProgress({
    object,
    entity,
    blueprint,
    onSelect,
}: Readonly<{ object: LayerObject; entity: LayoutRoom | LayoutFixture; blueprint: Blueprint; onSelect: () => void }>) {
    const enrichment = entity.enrichment;
    const running = enrichment.type === 'processing' && blueprint.status.type === 'processing' && blueprint.status.stage === 'entities';
    const reviewed = hasDetailedEntityDescription(entity);
    const status = reviewed ? undefined : enrichment.type === 'failed' ? 'error' : running ? 'running' : 'pending';
    return (
        <ProgressStep
            title={object.name}
            status={status}
            detail={
                reviewed
                    ? 'Reviewed'
                    : enrichment.type === 'failed'
                      ? 'Retry needed'
                      : running
                        ? 'Reviewing…'
                        : enrichment.type === 'complete'
                          ? 'Needs review'
                          : 'Waiting'
            }
            icon={<span className="size-2 shrink-0" style={{ backgroundColor: getDetectedObjectColor(object.property) }} />}
        >
            <p>
                {enrichment.type === 'complete'
                    ? enrichment.result.description
                    : enrichment.type === 'failed'
                      ? enrichment.error
                      : running
                        ? 'Reading this object’s drawing context…'
                        : 'Waiting for review.'}
            </p>
            <Button size="sm" variant="ghost" disabled={blueprint.attachment.hiddenFromCanvas} onClick={onSelect}>
                {blueprint.attachment.hiddenFromCanvas ? 'Hidden from canvas' : 'Show on drawing'}
            </Button>
        </ProgressStep>
    );
}

function BlueprintProgress({
    blueprint,
    objects,
    onSelect,
    drawingId,
    busy,
    now,
    stageStartedAt,
}: Readonly<{
    blueprint: Blueprint;
    objects: LayerObject[];
    onSelect: (object: LayerObject) => void;
    drawingId: string;
    busy: boolean;
    now: number;
    stageStartedAt?: string | null;
}>) {
    const entities = [...(blueprint.layout?.rooms ?? []), ...(blueprint.layout?.fixtures ?? [])];
    const completed = entities.filter(hasDetailedEntityDescription).length;
    const status = blueprint.status;
    const failed = status.type === 'partial' || status.type === 'failed';
    const activity = blueprint.processingActivity;
    const active = busy && status.type === 'processing' && activity?.status === 'running';
    const startedAt = active ? activity.startedAt : busy && status.type === 'processing' ? stageStartedAt : null;
    if (status.type === 'rejected')
        return (
            <Trace>
                <TraceLine status="error">
                    <TraceTitle>
                        Sheet {blueprint.pageNumber} · {busy ? 'Page rejected — continuing' : 'Page rejected'}
                    </TraceTitle>
                </TraceLine>
                <p className="text-xs text-destructive">{status.error}</p>
            </Trace>
        );

    return (
        <Trace>
            <TraceLine status={failed ? 'error' : status.type === 'processing' ? 'running' : status.type === 'ready' ? undefined : 'pending'}>
                <TraceTitle className="whitespace-normal">
                    Sheet {blueprint.pageNumber} ·{' '}
                    {failed
                        ? 'Review paused'
                        : status.type === 'ready'
                          ? 'Context saved'
                          : status.type === 'uploaded'
                            ? 'Waiting for analysis'
                            : status.type === 'not_configured'
                              ? 'Inference unavailable'
                              : active
                                ? activity.step
                                : stageLabels[status.stage]}
                    {startedAt && <span className="ml-2 tabular-nums">{elapsedTime(now - Date.parse(startedAt))}</span>}
                </TraceTitle>
            </TraceLine>
            {!blueprint.layout && <p className="text-xs">Waiting for room and fixture detection.</p>}
            {activity && activity.history.length > 0 && (
                <ProgressStep title="Completed steps" status={undefined} detail={`${activity.history.length}`}>
                    <Trace aria-label={`Completed steps for sheet ${blueprint.pageNumber}`}>
                        {activity.history.map((entry, index) => (
                            <TraceLine key={`${entry.startedAt}-${index}`}>
                                <TraceTitle>
                                    {entry.step}
                                    <span className="ml-2 tabular-nums text-xs">{elapsedTime(Date.parse(entry.finishedAt) - Date.parse(entry.startedAt))}</span>
                                </TraceTitle>
                            </TraceLine>
                        ))}
                    </Trace>
                </ProgressStep>
            )}
            {activity?.status === 'failed' && status.type !== 'ready' && (
                <TraceLine status="error">
                    <TraceTitle>
                        {activity.step} · failed after {elapsedTime(Date.parse(activity.updatedAt) - Date.parse(activity.startedAt))}
                    </TraceTitle>
                </TraceLine>
            )}
            <DrawingNotes blueprint={blueprint} drawingId={drawingId} busy={busy} />
            {(['room', 'icon'] as const).map((type) => {
                const items = objects.filter((object) => object.property.type === type);
                if (items.length === 0) return null;
                return (
                    <div key={type} className="space-y-2">
                        <p className="text-xs font-medium">{type === 'room' ? 'Rooms' : 'Fixtures'}</p>
                        {[...new Set(items.map((object) => object.property.label))]
                            .sort((a, b) => a.localeCompare(b))
                            .map((category) => {
                                const members = items.filter((object) => object.property.label === category);
                                const memberIds = new Set(members.map((object) => object.property.id));
                                const group = entities.filter((entity) => memberIds.has(entity.id));
                                const complete = group.filter(hasDetailedEntityDescription).length;
                                const running =
                                    status.type === 'processing' &&
                                    status.stage === 'entities' &&
                                    group.some((entity) => entity.enrichment.type === 'processing');
                                const error = group.some((entity) => entity.enrichment.type === 'failed');
                                return (
                                    <ProgressStep
                                        key={category}
                                        title={category}
                                        status={running ? 'running' : error ? 'error' : complete === group.length ? undefined : 'pending'}
                                        detail={`${complete} / ${group.length}`}
                                        icon={
                                            <span className="size-2 shrink-0" style={{ backgroundColor: getDetectedObjectColor({ type, label: category }) }} />
                                        }
                                    >
                                        <Trace>
                                            {members.map((object) => {
                                                const entity = group.find((entity) => entity.id === object.property.id);
                                                return entity ? (
                                                    <ObjectProgress
                                                        key={entity.id}
                                                        object={object}
                                                        entity={entity}
                                                        blueprint={blueprint}
                                                        onSelect={() => onSelect(object)}
                                                    />
                                                ) : null;
                                            })}
                                        </Trace>
                                    </ProgressStep>
                                );
                            })}
                    </div>
                );
            })}
            {!!blueprint.layout?.slabs.length && (
                <div className="space-y-2">
                    <p className="text-xs font-medium">Slabs · {blueprint.layout.slabs.length} saved</p>
                    {objects
                        .filter((object) => object.property.type === 'slab')
                        .map((object) => {
                            const slab = blueprint.layout?.slabs.find((item) => item.id === object.property.id);
                            const thickness = slab?.measurements.thickness;
                            return (
                                <ProgressStep
                                    key={object.property.id}
                                    title={object.name}
                                    status={undefined}
                                    detail="Needs review"
                                    icon={<span className="size-2 shrink-0" style={{ backgroundColor: getDetectedObjectColor(object.property) }} />}
                                >
                                    <p>Thickness: {thickness ? `${thickness.value} ${thickness.unit ?? '(unit unspecified)'}` : 'Not available'}</p>
                                    <Button size="sm" variant="ghost" disabled={blueprint.attachment.hiddenFromCanvas} onClick={() => onSelect(object)}>
                                        {blueprint.attachment.hiddenFromCanvas ? 'Hidden from canvas' : 'Show on drawing'}
                                    </Button>
                                </ProgressStep>
                            );
                        })}
                </div>
            )}
            {blueprint.layout && entities.length > 0 && (
                <p className="text-xs">
                    {completed} / {entities.length} objects reviewed
                </p>
            )}
            <DrawingScale blueprint={blueprint} drawingId={drawingId} busy={busy} />
            {failed && (
                <p role="alert" className="text-xs text-destructive">
                    {status.error}
                </p>
            )}
        </Trace>
    );
}

export function DrawingProgress({ drawing, busy, stage, onRetry }: Readonly<{ drawing: Drawing; busy: boolean; stage?: string; onRetry?: () => void }>) {
    const [open, setOpen] = useState<boolean>();
    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        if (!busy) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [busy]);
    const selectObject = useUnit($$drawings.canvasSelectionRequested);
    const blueprints = drawing.blueprints;
    const ready = blueprints.length > 0 && blueprints.every((blueprint) => blueprint.status.type === 'ready');
    const objects = layerObjects(blueprints);
    const retrying = drawing.processing?.status === 'queued' && (drawing.processing.attempts ?? 0) > 0;
    const retryAt = drawing.processing?.availableAt ? Date.parse(drawing.processing.availableAt) : now;
    const label = ready
        ? 'Blueprint context saved'
        : drawing.processing && drawing.processing.status !== 'completed'
          ? `${retrying ? 'Retrying analysis' : 'Processing pages'} · ${drawing.processing.completed} / ${drawing.processing.total} finished`
          : busy
            ? (stage ?? 'Preparing your blueprint')
            : drawing.processing?.status === 'completed'
              ? 'Finished with page errors'
              : 'Analysis paused';
    if (!blueprints.length && !busy) return null;
    return (
        <div className="space-y-2" aria-label="Blueprint preparation progress">
            <p role="status" className="sr-only">
                {label}
            </p>
            <Trace>
                <TraceCollapsible open={open ?? (busy && !ready)} onOpenChange={setOpen}>
                    <TraceCollapsibleTrigger>
                        <TraceLine status={busy && !ready ? 'running' : undefined}>
                            <TraceIcon>
                                <BrandLogo iconOnly className="!h-4" />
                            </TraceIcon>
                            <TraceTitle>{label}</TraceTitle>
                        </TraceLine>
                    </TraceCollapsibleTrigger>
                    <TraceCollapsibleContent className="space-y-4 text-sm">
                        {retrying && (
                            <p role="status" className="text-xs text-muted-foreground">
                                {retryAt > now ? `Retrying in ${elapsedTime(retryAt - now)}.` : 'Retrying from the saved checkpoint…'} Completed results are
                                saved.
                            </p>
                        )}
                        {drawing.processing?.status === 'running' && (drawing.processing.attempts ?? 0) > 1 && (
                            <p className="text-xs text-muted-foreground">Attempt {drawing.processing.attempts} · resuming saved results</p>
                        )}
                        {blueprints.map((blueprint) => (
                            <BlueprintProgress
                                key={blueprint.id}
                                blueprint={blueprint}
                                drawingId={drawing.id}
                                busy={busy}
                                now={now}
                                stageStartedAt={drawing.processing?.currentPage === blueprint.pageNumber ? drawing.processing.startedAt : null}
                                objects={objects.filter((object) => object.page === blueprint.pageNumber)}
                                onSelect={({ page, index }) => selectObject({ id: drawing.id, page, index })}
                            />
                        ))}
                    </TraceCollapsibleContent>
                </TraceCollapsible>
            </Trace>
            {!busy && !ready && onRetry && (
                <Button size="sm" variant="ghost" onClick={onRetry}>
                    Retry incomplete pages
                </Button>
            )}
        </div>
    );
}
