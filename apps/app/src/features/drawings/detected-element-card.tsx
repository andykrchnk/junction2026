import type { LayoutRoom } from '@repo/types';
import type { ReactNode } from 'react';
import { Button } from '@repo/design-system/components/ui/button';
import { X } from '@repo/design-system/lib/icons-remix';

export function DetectedElementCard({
    label,
    area,
    enrichment,
    onClose,
    children,
}: Readonly<{
    label: string;
    area: string;
    enrichment?: LayoutRoom['enrichment'];
    onClose: () => void;
    children?: ReactNode;
}>) {
    const details = enrichment?.type === 'complete' ? enrichment.result : null;
    const attributes = details?.attributes.filter((attribute) => attribute.source === 'observed' && String(attribute.value) !== details.name).slice(0, 3) ?? [];
    return (
        <section aria-label="Detected element properties" className="max-h-[65svh] max-w-full overflow-auto border bg-card p-3 text-sm shadow-sm">
            <div className="flex items-center gap-3">
                <h2 className="min-w-0 truncate text-base font-semibold" title={label}>
                    {label}
                </h2>
                <span aria-label="Area" className="shrink-0 whitespace-nowrap font-medium tabular-nums">
                    {area}
                </span>
                <Button type="button" size="icon-compact" variant="ghost" className="shrink-0" aria-label="Close element properties" onClick={onClose}>
                    <X />
                </Button>
            </div>
            {children}
            {(details?.name || attributes.length > 0) && (
                <dl className="mt-3 space-y-2 border-t pt-3 text-xs">
                    {details?.name && details.name !== label && (
                        <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-muted-foreground">Name</dt>
                            <dd className="min-w-0 break-words text-right">{details.name}</dd>
                        </div>
                    )}
                    {attributes.map((attribute, index) => (
                        <div key={index} className="flex items-baseline justify-between gap-3">
                            <dt className="min-w-0 text-muted-foreground">{attribute.name}</dt>
                            <dd className="line-clamp-2 min-w-0 break-words text-right">
                                {String(attribute.value)}
                                {attribute.unit ? ` ${attribute.unit}` : ''}
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
        </section>
    );
}
