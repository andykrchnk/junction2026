import type { PpmDoorFallback } from '@repo/types';

export function PpmDoorFallbackDetails({ fallback }: Readonly<{ fallback: PpmDoorFallback }>) {
    return (
        <span className="mt-2 block space-y-2 text-xs text-muted-foreground">
            <span className="block font-medium">
                Assumed door opening: {fallback.assumedOpeningWidthMm.toLocaleString()} mm
                {fallback.method === 'default' ? ' (default)' : ' (reference-based estimate)'}
            </span>
            {fallback.assumptions.map((assumption, index) => (
                <span key={index} className="block">
                    {assumption}
                </span>
            ))}
            {fallback.sources.map((source, index) => (
                <span key={index} className="block">
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                        {source.title}
                    </a>
                    <span className="mt-1 block">{source.evidence}</span>
                </span>
            ))}
        </span>
    );
}
