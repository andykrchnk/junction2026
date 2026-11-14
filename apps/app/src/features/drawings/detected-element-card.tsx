import { Button } from '@repo/design-system/components/ui/button';
import { X } from '@repo/design-system/lib/icons-remix';

export function DetectedElementCard({ label, area, onClose }: Readonly<{ label: string; area: string; onClose: () => void }>) {
    return (
        <section aria-label="Detected element properties" className="flex max-w-full items-center gap-3 border bg-card p-3 text-sm shadow-sm">
            <h2 className="min-w-0 truncate text-base font-semibold" title={label}>
                {label}
            </h2>
            <span aria-label="Area" className="shrink-0 whitespace-nowrap font-medium tabular-nums">
                {area}
            </span>
            <Button type="button" size="icon-compact" variant="ghost" className="shrink-0" aria-label="Close element properties" onClick={onClose}>
                <X />
            </Button>
        </section>
    );
}
