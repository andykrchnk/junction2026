import type { Drawing } from '@repo/types';
import { useState } from 'react';
import { BrandLogo } from '@repo/design-system/components/ui/brand-logo';
import {
    Trace,
    TraceLine,
    TraceTitle,
    TraceIcon,
    TraceCollapsible,
    TraceCollapsibleTrigger,
    TraceCollapsibleContent,
} from '@repo/design-system/components/ui/trace';

export function DrawingProgress({ drawing, busy, stage }: Readonly<{ drawing: Drawing; busy: boolean; stage?: string }>) {
    const [open, setOpen] = useState<boolean>();
    const uploaded = Boolean(drawing.attachment);
    const analyzed = Boolean(drawing.analysis);
    const detection = drawing.detection;
    const detected = detection?.status === 'ready';
    const detecting = !detected && !analyzed && detection?.status === 'processing';
    const reviewing = busy && uploaded && !analyzed && detected;
    const detectionNotice =
        detection?.status === 'failed'
            ? `Object detection failed. Blueprint review is paused. ${detection.error ?? 'Retry detection to continue.'}`
            : detection?.status === 'not_configured'
              ? 'Object detection is unavailable. Blueprint review is paused until detection is configured.'
              : detection?.status === 'partial'
                ? `Only some pages have detection results. Blueprint review is paused. ${detection.error ?? 'Retry detection to cover all pages.'}`
                : analyzed && !detected
                  ? 'Complete object detection results were not saved for this analysis.'
                  : null;

    if (!uploaded && !busy) return null;

    return (
        <div className="space-y-2" aria-label="Blueprint preparation progress">
            <Trace>
                <TraceCollapsible open={open ?? (busy && !analyzed)} onOpenChange={setOpen}>
                    <TraceCollapsibleTrigger>
                        <TraceLine status={busy && !analyzed ? 'running' : undefined}>
                            <TraceIcon>
                                <BrandLogo iconOnly className="!h-4" />
                            </TraceIcon>
                            <TraceTitle>{analyzed ? 'Blueprint analysis saved' : busy ? (stage ?? 'Preparing your blueprint') : 'Analysis paused'}</TraceTitle>
                        </TraceLine>
                    </TraceCollapsibleTrigger>
                    <TraceCollapsibleContent className="space-y-2 text-sm">
                        <TraceLine status={uploaded ? undefined : busy ? 'running' : 'pending'}>
                            <TraceTitle>{uploaded ? 'Blueprint uploaded' : 'Uploading blueprint'}</TraceTitle>
                        </TraceLine>
                        <TraceLine status={detected ? undefined : detecting && busy ? 'running' : 'pending'}>
                            <TraceTitle>{detected ? 'Rooms and objects detected' : 'Detecting rooms and objects'}</TraceTitle>
                        </TraceLine>
                        {detectionNotice && <p className="px-2 py-1 text-xs text-muted-foreground">{detectionNotice}</p>}
                        <TraceLine status={analyzed ? undefined : reviewing ? 'running' : 'pending'}>
                            <TraceTitle>{analyzed ? 'Blueprint review saved' : 'Reviewing blueprint'}</TraceTitle>
                        </TraceLine>
                        {!busy && !analyzed && (
                            <p className="px-2 py-1 text-xs text-muted-foreground">Analysis is paused. Start or retry analysis to continue.</p>
                        )}
                    </TraceCollapsibleContent>
                </TraceCollapsible>
            </Trace>
        </div>
    );
}
