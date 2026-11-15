import { getDetectedObjectColor, hasDetailedEntityDescription, type Blueprint, type Drawing, type LayoutRoom, type LayoutFixture } from '@repo/types';
import { useState } from 'react';
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
}: Readonly<{ blueprint: Blueprint; objects: LayerObject[]; onSelect: (object: LayerObject) => void; drawingId: string; busy: boolean }>) {
    const entities = [...(blueprint.layout?.rooms ?? []), ...(blueprint.layout?.fixtures ?? [])];
    const completed = entities.filter(hasDetailedEntityDescription).length;
    const status = blueprint.status;
    const failed = status.type === 'partial' || status.type === 'failed';
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
                              : stageLabels[status.stage]}
                </TraceTitle>
            </TraceLine>
            {!blueprint.layout && <p className="text-xs">Waiting for room and fixture detection.</p>}
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
            {blueprint.layout && (
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
    const selectObject = useUnit($$drawings.canvasSelectionRequested);
    const blueprints = drawing.blueprints;
    const ready = blueprints.length > 0 && blueprints.every((blueprint) => blueprint.status.type === 'ready');
    const objects = layerObjects(blueprints);
    const label = ready
        ? 'Blueprint context saved'
        : drawing.processing && drawing.processing.status !== 'completed'
          ? `Processing pages · ${drawing.processing.completed} / ${drawing.processing.total} finished`
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
                        {blueprints.map((blueprint) => (
                            <BlueprintProgress
                                key={blueprint.id}
                                blueprint={blueprint}
                                drawingId={drawing.id}
                                busy={busy}
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
