import { Crosshair, remixIcons } from '@repo/design-system/lib/icons-remix';

const AreaIcon = remixIcons.maximize;
const ConfidenceIcon = Crosshair;

function Divider() {
    return (
        <svg aria-hidden width={1} height={14} viewBox="0 0 1 14" style={{ display: 'block', flex: '0 0 1px', alignSelf: 'center', opacity: 0.5 }}>
            {/* Snap both separators to pixel edges even when text gives them fractional positions. */}
            <rect width={1} height={14} fill="currentColor" shapeRendering="crispEdges" />
        </svg>
    );
}

export function DetectedObjectTooltipCard({ label, area, confidence }: Readonly<{ label: string; area: string; confidence: number | null }>) {
    const percentage = confidence === null ? 'Needs review' : `${Math.round(confidence * 100)}%`;
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                height: 29,
                boxSizing: 'border-box',
                padding: '0 10px',
                color: '#ffffff',
                fontSize: 12,
                lineHeight: '16px',
            }}
        >
            <strong style={{ fontWeight: 700 }}>{label}</strong>
            <Divider />
            <span aria-label={`Area: ${area}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                <AreaIcon size={14} aria-hidden />
                {area}
            </span>
            <Divider />
            <span
                aria-label={confidence === null ? percentage : `Model confidence: ${percentage}`}
                title={confidence === null ? 'Unverified slab proposal' : 'Model confidence'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
            >
                <ConfidenceIcon size={14} aria-hidden />
                {percentage}
            </span>
        </div>
    );
}
