import type { DetectedProperty } from '@repo/types';
import { Button } from '@repo/design-system/components/ui/button';
import { X } from '@repo/design-system/lib/icons-remix';

export function DetectedElementCard({
    property,
    page,
    onClose,
}: Readonly<{ property: Pick<DetectedProperty, 'label' | 'confidence' | 'areaPixels'>; page: number; onClose: () => void }>) {
    return (
        <section aria-label="Detected element properties" className="w-72 max-w-full border bg-card p-4 text-sm shadow-sm">
            <div className="flex items-center justify-between gap-5">
                <div>
                    <h2 className="text-lg font-semibold">{property.label}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Sheet {page}</p>
                </div>
                <Button size="icon-compact" variant="ghost" leadingIcon={X} aria-label="Close element properties" onClick={onClose} />
            </div>
            {property.areaPixels !== null && (
                <dl className="mt-4 border-t pt-4">
                    <div>
                        <dt className="text-xs text-muted-foreground">Pixel area</dt>
                        <dd className="mt-1 text-xl font-semibold tabular-nums">
                            {Math.round(property.areaPixels).toLocaleString()} <span className="text-xs font-normal">px²</span>
                        </dd>
                    </div>
                </dl>
            )}
            <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                Uncalibrated prediction. Pixel area is not a verified real-world measurement.
            </p>
        </section>
    );
}
