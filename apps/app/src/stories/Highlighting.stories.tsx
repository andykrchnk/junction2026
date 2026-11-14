import type { Meta, StoryObj } from '@storybook/react-vite';
import { DETECTED_OBJECT_COLORS, getDetectedObjectColor } from '@repo/types';
import '@/features/drawings/blueprint-canvas.css';

const states = ['Default', 'Hover', 'Selected'] as const;

function HighlightingGallery() {
    return (
        <main className="mx-auto max-w-6xl space-y-8">
            <header className="space-y-2">
                <h1 className="text-2xl font-semibold">Drawing highlighting</h1>
                <p className="text-muted-foreground">
                    Rooms use 3px solid outlines with no default fill and 12% hover fill; selected rooms have moving dashed outlines with 30% fill. Fixtures and
                    junctions use solid color blocks without outlines: 85% by default, 95% on hover, and a pulsing fill when selected. Reduced-motion
                    preferences stop animations.
                </p>
                <p className="text-sm text-muted-foreground">
                    Hover is held visible for comparison. The sketch is illustrative; colors and default/selected styles come from the viewer.
                </p>
            </header>
            <section aria-label="Highlighting color palette" className="space-y-4">
                <h2 className="text-lg font-semibold">Color palette · Rooms, fixtures and junctions</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
                    {(['room', 'icon', 'junction'] as const).flatMap((type) => [
                        <h3 key={type} className="font-medium" style={{ gridColumn: '1 / -1' }}>
                            {type === 'room' ? 'Rooms' : type === 'icon' ? 'Fixtures · doors, windows and equipment' : 'Structural junctions'}
                        </h3>,
                        ...[...Object.entries(DETECTED_OBJECT_COLORS[type]), ['Fallback', getDetectedObjectColor({ type, label: '__fallback__' })]].map(
                            ([label, color]) => (
                                <div key={`${type}-${label}`}>
                                    <div className="rounded border" style={{ backgroundColor: color, height: 72, marginBottom: 8 }} />
                                    <p className="text-sm font-medium">{label}</p>
                                    <p className="text-xs text-muted-foreground">{type}</p>
                                    <code className="text-xs text-muted-foreground">{color}</code>
                                </div>
                            ),
                        ),
                    ])}
                </div>
            </section>
            {(['room', 'icon', 'junction'] as const).map((type) => (
                <section key={type} className="space-y-4">
                    <h2 className="text-lg font-semibold">{type === 'room' ? 'Rooms' : type === 'icon' ? 'Fixtures' : 'Structural junctions'}</h2>
                    {[
                        ...Object.entries(DETECTED_OBJECT_COLORS[type]),
                        ['Unknown label (fallback)', getDetectedObjectColor({ type, label: '__fallback__' })],
                    ].map(([label, color]) => (
                        <article key={label} className="rounded-lg border p-4">
                            <div className="mb-3 flex items-center gap-3">
                                <span className="size-4 rounded-sm" style={{ backgroundColor: color }} />
                                <h3 className="font-medium">{label}</h3>
                                <code className="text-xs text-muted-foreground">{color}</code>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                                {states.map((state) => (
                                    <figure key={state}>
                                        <svg
                                            viewBox="0 0 240 140"
                                            role="img"
                                            aria-label={`${label}: ${state} outline`}
                                            className="w-full rounded border bg-white"
                                        >
                                            <path
                                                d="M18 120V20H222V120H18 M88 20V56 M88 94V120 M160 20V120 M18 80H88 M160 80H222"
                                                fill="none"
                                                stroke="#a3a3a3"
                                                strokeWidth="3"
                                            />
                                            <path d="M88 56Q126 56 126 94H88" fill="none" stroke="#d4d4d4" />
                                            <g style={{ color }} stroke={color} strokeWidth={type === 'room' ? 3 : 1.5}>
                                                {type === 'junction' ? (
                                                    <circle
                                                        data-detected-object
                                                        data-detected-type={type}
                                                        aria-pressed={state === 'Selected'}
                                                        cx="88"
                                                        cy="80"
                                                        r="3"
                                                        style={state === 'Hover' ? { fillOpacity: 0.95 } : undefined}
                                                    />
                                                ) : (
                                                    <path
                                                        data-detected-object
                                                        data-detected-type={type}
                                                        aria-pressed={state === 'Selected'}
                                                        d={type === 'room' ? 'M22 24H156V116H92V76H22Z' : 'M170 34H210V64H170Z'}
                                                        vectorEffect="non-scaling-stroke"
                                                        style={
                                                            state === 'Hover'
                                                                ? type === 'room'
                                                                    ? { fill: 'color-mix(in srgb, currentColor 12%, transparent)' }
                                                                    : { fillOpacity: 0.95 }
                                                                : undefined
                                                        }
                                                    />
                                                )}
                                            </g>
                                        </svg>
                                        <figcaption className="mt-2 text-sm text-muted-foreground">{state}</figcaption>
                                    </figure>
                                ))}
                            </div>
                        </article>
                    ))}
                </section>
            ))}
        </main>
    );
}

const meta = { title: 'Official/Canvas/Highlighting', component: HighlightingGallery } satisfies Meta<typeof HighlightingGallery>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllColorsAndStates: Story = {};
