import { useContext } from 'react';
import { useUnit } from 'effector-react';
import { createShapeId, useEditor, useValue } from 'tldraw';
import { DetectionContext } from './detection-layer';
import type { CanvasModel } from './canvas/model';

function EvidenceRegion({ model }: Readonly<{ model: CanvasModel }>) {
    const editor = useEditor();
    const region = useUnit(model.$regionFocus);
    const points = useValue(
        'evidence source region',
        () => {
            if (!region?.bounds) return null;
            const shape = editor.getShape(createShapeId(`blueprint-${region.page}`));
            if (!shape || shape.type !== 'image' || shape.meta.blueprintHidden) return null;
            const transform = editor.getShapePageTransform(shape);
            const { left, top, right, bottom } = region.bounds;
            return [
                [left, top],
                [right, top],
                [right, bottom],
                [left, bottom],
            ]
                .map(([x, y]) => {
                    const point = transform.applyToPoint({ x: x * shape.props.w, y: y * shape.props.h });
                    return `${point.x},${point.y}`;
                })
                .join(' ');
        },
        [editor, region],
    );
    if (!region || !points) return null;
    return (
        <svg
            aria-label={`Highlighted source: ${region.label}`}
            style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none', zIndex: 100001 }}
        >
            <polygon points={points} fill="var(--primary)" fillOpacity={0.12} stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

export function CanvasEvidenceLayer() {
    const context = useContext(DetectionContext);
    return context ? <EvidenceRegion model={context.model} /> : null;
}
