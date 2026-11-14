import type { Drawing } from '@repo/types';
import { useState } from 'react';
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

const stageLabels = {
    inference: 'Detecting rooms and fixtures',
    misc: 'Reading drawing notes',
    entities: 'Describing rooms and fixtures',
    ppm: 'Estimating scale',
};

export function DrawingProgress({ drawing, busy, stage, onRetry }: Readonly<{ drawing: Drawing; busy: boolean; stage?: string; onRetry?: () => void }>) {
    const [open, setOpen] = useState<boolean>();
    const blueprints = drawing.blueprints;
    const ready = blueprints.length > 0 && blueprints.every((blueprint) => blueprint.status.type === 'ready');
    if (!drawing.blueprints.length && !busy) return null;
    return (
        <div className="space-y-2" aria-label="Blueprint preparation progress">
            <Trace>
                <TraceCollapsible open={open ?? (busy && !ready)} onOpenChange={setOpen}>
                    <TraceCollapsibleTrigger>
                        <TraceLine status={busy && !ready ? 'running' : undefined}>
                            <TraceIcon>
                                <BrandLogo iconOnly className="!h-4" />
                            </TraceIcon>
                            <TraceTitle>
                                {ready
                                    ? 'Blueprint context saved'
                                    : drawing.processing && drawing.processing.status !== 'completed'
                                      ? `Processing pages · ${drawing.processing.completed} / ${drawing.processing.total} finished`
                                      : busy
                                        ? (stage ?? 'Preparing your blueprint')
                                        : drawing.processing?.status === 'completed'
                                          ? 'Finished with page errors'
                                          : 'Analysis paused'}
                            </TraceTitle>
                        </TraceLine>
                    </TraceCollapsibleTrigger>
                    <TraceCollapsibleContent className="space-y-3 text-sm">
                        {blueprints.map((blueprint) => {
                            const entities = [...(blueprint.layout?.rooms ?? []), ...(blueprint.layout?.fixtures ?? [])];
                            const complete = entities.filter((entity) => entity.enrichment.type === 'complete').length;
                            const error =
                                blueprint.status.type === 'partial' || blueprint.status.type === 'failed' || blueprint.status.type === 'rejected'
                                    ? blueprint.status.error
                                    : null;
                            return (
                                <div key={blueprint.id} className="space-y-1">
                                    <TraceLine
                                        status={blueprint.status.type === 'ready' ? undefined : blueprint.status.type === 'processing' ? 'running' : 'pending'}
                                    >
                                        <TraceTitle>
                                            Sheet {blueprint.pageNumber} ·{' '}
                                            {blueprint.status.type === 'ready'
                                                ? 'Context saved'
                                                : blueprint.status.type === 'rejected'
                                                  ? busy
                                                      ? 'Page rejected — continuing'
                                                      : 'Page rejected'
                                                  : blueprint.status.type === 'failed' || blueprint.status.type === 'partial'
                                                    ? 'Processing incomplete'
                                                    : blueprint.status.type === 'uploaded'
                                                      ? 'Waiting for analysis'
                                                      : blueprint.status.type === 'not_configured'
                                                        ? 'Inference unavailable'
                                                        : stageLabels[blueprint.status.stage]}
                                        </TraceTitle>
                                    </TraceLine>
                                    <p className="px-2 text-xs text-muted-foreground">
                                        {blueprint.status.type === 'rejected'
                                            ? 'No analysis results for this page.'
                                            : blueprint.layout
                                              ? `${complete} / ${entities.length} detected objects described`
                                              : 'Waiting for room and fixture detection'}{' '}
                                        {blueprint.status.type !== 'rejected' && (
                                            <>
                                                · {blueprint.misc === null ? 'General notes pending' : 'General notes saved'} ·{' '}
                                                {blueprint.ppm === null ? 'Scale pending' : blueprint.ppm.value ? 'Scale estimated' : 'Scale unresolved'}
                                            </>
                                        )}
                                    </p>
                                    {error && <p className="px-2 text-xs text-destructive">{error}</p>}
                                </div>
                            );
                        })}
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
