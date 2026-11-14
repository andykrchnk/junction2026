import type { DetectedProperty, ProcessingPrediction } from './prediction';

type SemanticColors = Readonly<{
    room: Readonly<Record<ProcessingPrediction['rooms'][number]['class'], string>>;
    icon: Readonly<Record<ProcessingPrediction['fixtures'][number]['class'], string>>;
    junction: Readonly<Record<'Structural junction', string>>;
}>;

// Fixed, globally unique mid-tone colors shared by the canvas and generated covers.
export const DETECTED_OBJECT_COLORS = {
    room: {
        Background: '#657789',
        Outdoor: '#50883f',
        Wall: '#9a6656',
        Kitchen: '#d1495b',
        'Living Room': '#238879',
        Bedroom: '#8260bc',
        Bath: '#b07b20',
        Hallway: '#387ac2',
        Railing: '#8b7e39',
        Storage: '#b14d90',
        Garage: '#4f7894',
        Undefined: '#8a737f',
    },
    icon: {
        'No Icon': '#777777',
        Window: '#2c8da8',
        Door: '#bd6b39',
        Closet: '#9d5fc0',
        'Electrical Appliance': '#5479d3',
        Toilet: '#8b8a24',
        Sink: '#27958f',
        'Sauna Bench': '#b85e63',
        'Fire Place': '#c15c28',
        Bathtub: '#6977ad',
        Chimney: '#96742e',
    },
    junction: {
        'Structural junction': '#9168a3',
    },
} as const satisfies SemanticColors;

const FALLBACK_COLORS = { room: '#6b7280', icon: '#78716c', junction: '#71717a' } as const;

export function getDetectedObjectColor(params: Pick<DetectedProperty, 'type' | 'label'>): string {
    const colors: Readonly<Record<string, string>> = DETECTED_OBJECT_COLORS[params.type];
    return Object.hasOwn(colors, params.label) ? colors[params.label] : FALLBACK_COLORS[params.type];
}
