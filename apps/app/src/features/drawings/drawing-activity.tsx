import { useEffect, useState } from 'react';
import { BrandLogo } from '@repo/design-system/components/ui/brand-logo';

/** Mounted for the duration of an operation; stage changes keep the timer running. */
export function DrawingActivity({ label }: Readonly<{ label: string }>) {
    const [startedAt] = useState(() => Date.now());
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
        const interval = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
        return () => window.clearInterval(interval);
    }, [startedAt]);
    const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

    return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BrandLogo iconOnly className="!h-5 shrink-0 motion-safe:animate-pulse" />
            <span role="status" className="min-w-0 flex-1">
                {label}
            </span>
            <span role="timer" aria-label={`Elapsed time: ${elapsed}`} className="shrink-0 text-xs tabular-nums">
                {elapsed}
            </span>
        </div>
    );
}
