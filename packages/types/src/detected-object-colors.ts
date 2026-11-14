import type { DetectedProperty, ProcessingPrediction } from './prediction';

type SemanticColors = Readonly<{
    room: Readonly<Record<ProcessingPrediction['rooms'][number]['class'], string>>;
    icon: Readonly<Record<ProcessingPrediction['fixtures'][number]['class'], string>>;
    junction: Readonly<Record<'Structural junction', string>>;
}>;

// Fixed, globally unique vivid colors shared by the canvas and generated covers.
export const DETECTED_OBJECT_COLORS = {
    room: {
        Background: '#4263c7',
        Outdoor: '#339c0b',
        Wall: '#c44824',
        Kitchen: '#f01440',
        'Living Room': '#00a889',
        Bedroom: '#8030ed',
        Bath: '#ce8800',
        Hallway: '#0879f5',
        Railing: '#a28e00',
        Storage: '#e312a2',
        Garage: '#007faa',
        Undefined: '#975777',
        Sauna: '#e56b08',
        Balcony: '#47a51c',
    },
    icon: {
        'No Icon': '#777777',
        Window: '#0062ff',
        Door: '#ff6200',
        Closet: '#ac19f5',
        'Electrical Appliance': '#354dff',
        Toilet: '#999d00',
        Sink: '#00b3ad',
        'Sauna Bench': '#ee2649',
        'Fire Place': '#f04408',
        Bathtub: '#5355ed',
        Chimney: '#bb7900',
    },
    junction: {
        'Structural junction': '#b32be0',
    },
} as const satisfies SemanticColors;

const FALLBACK_COLORS = { room: '#6b7280', icon: '#78716c', junction: '#71717a' } as const;

export function getDetectedObjectColor(params: Pick<DetectedProperty, 'type' | 'label'>): string {
    const colors: Readonly<Record<string, string>> = DETECTED_OBJECT_COLORS[params.type];
    return Object.hasOwn(colors, params.label) ? colors[params.label] : FALLBACK_COLORS[params.type];
}
