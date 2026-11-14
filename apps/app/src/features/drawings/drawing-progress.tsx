import type { Drawing } from '@repo/types';
import { ThinkingIndicator } from '@repo/design-system/components/ui/thinking-indicator';
import { ThinkingStep, ThinkingSteps, ThinkingStepsContent, ThinkingStepsHeader } from '@repo/design-system/components/ui/thinking-steps';

export function DrawingProgress({ drawing, busy }: Readonly<{ drawing: Drawing; busy: boolean }>) {
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
            {busy && !analyzed && <ThinkingIndicator aria-label="Processing blueprint" />}
            <ThinkingSteps className="w-full" defaultOpen={!analyzed}>
                <ThinkingStepsHeader>{analyzed ? 'Blueprint analysis saved' : busy ? 'Preparing your blueprint' : 'Analysis paused'}</ThinkingStepsHeader>
                <ThinkingStepsContent>
                    <ThinkingStep
                        label={uploaded ? 'Blueprint uploaded' : 'Uploading blueprint'}
                        status={uploaded ? 'complete' : busy ? 'active' : 'pending'}
                        delay={0}
                    />
                    <ThinkingStep
                        label={detected ? 'Rooms and objects detected' : 'Detecting rooms and objects'}
                        status={detected ? 'complete' : detecting && busy ? 'active' : 'pending'}
                        delay={0}
                    />
                    {detectionNotice && <p className="px-2 py-1 text-xs text-muted-foreground">{detectionNotice}</p>}
                    <ThinkingStep
                        label={analyzed ? 'Blueprint review saved' : 'Reviewing blueprint'}
                        status={analyzed ? 'complete' : reviewing ? 'active' : 'pending'}
                        description={analyzed ? 'The chat can use the saved analysis.' : undefined}
                        delay={0}
                        isLast
                    />
                    {!busy && !analyzed && <p className="px-2 py-1 text-xs text-muted-foreground">Analysis is paused. Start or retry analysis to continue.</p>}
                </ThinkingStepsContent>
            </ThinkingSteps>
        </div>
    );
}
