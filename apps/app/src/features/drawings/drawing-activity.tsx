import { BrandLogo } from '@repo/design-system/components/ui/brand-logo';
import { Trace, TraceLine, TraceIcon, TraceTitle } from '@repo/design-system/components/ui/trace';

export function DrawingActivity({ label }: Readonly<{ label: string }>) {
    return (
        <Trace>
            <TraceLine status="running" role="status">
                <TraceIcon>
                    <BrandLogo iconOnly className="!h-4" />
                </TraceIcon>
                <TraceTitle>{label}</TraceTitle>
            </TraceLine>
        </Trace>
    );
}
