import type { LayoutRoom } from '@repo/types';
import { Button } from '@repo/design-system/components/ui/button';
import { X } from '@repo/design-system/lib/icons-remix';

export function DetectedElementCard({
    label,
    area,
    enrichment,
    onClose,
}: Readonly<{
    label: string;
    area: string;
    enrichment?: LayoutRoom['enrichment'];
    onClose: () => void;
}>) {
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
            <div className="max-w-80">
                {' '}
                {enrichment?.type === 'complete' && (
                    <div className="mt-3 space-y-2">
                        {enrichment.result.name && <p className="font-medium">{enrichment.result.name}</p>}
                        {enrichment.result.interpretedClass && enrichment.result.interpretedClass !== label && (
                            <p className="text-xs text-muted-foreground">Interpreted as {enrichment.result.interpretedClass}</p>
                        )}
                        <p>{enrichment.result.description}</p>
                        <dl className="space-y-2">
                            {enrichment.result.attributes.map((attribute, index) => (
                                <div key={index}>
                                    <dt className="text-xs text-muted-foreground">
                                        {attribute.name} · {attribute.source}
                                    </dt>
                                    <dd>
                                        {String(attribute.value)}
                                        {attribute.unit ? ` ${attribute.unit}` : ''}
                                    </dd>
                                    <dd className="text-xs text-muted-foreground">{attribute.evidence}</dd>
                                </div>
                            ))}
                        </dl>
                        {enrichment.result.evidence.map((evidence, index) => (
                            <p key={index} className="text-xs text-muted-foreground">
                                {evidence}
                            </p>
                        ))}
                        {enrichment.result.uncertainties.map((uncertainty, index) => (
                            <p key={index} className="text-xs text-muted-foreground">
                                Uncertain: {uncertainty}
                            </p>
                        ))}
                    </div>
                )}
                {enrichment?.type === 'pending' && <p className="mt-3 text-xs text-muted-foreground">Description pending.</p>}
                {enrichment?.type === 'failed' && <p className="mt-3 text-xs text-destructive">{enrichment.error}</p>}
            </div>
        </section>
    );
}
