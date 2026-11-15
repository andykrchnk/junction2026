import { useState, type ReactNode } from 'react';
import type { Drawing } from '@repo/types';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent } from '@repo/design-system/components/ui/context-menu';
import { MenuItem } from '@repo/design-system/components/ui/menu-item';
import { layoutPages } from './layout';
import { createPpmAdjustmentModel } from './ppm-adjustment-model';
import { PpmAdjustmentDialog } from './ppm-adjustment-dialog';
import { objectAnnotationContext, type ObjectAnnotationContext } from './annotation-context';

type ObjectMenuTarget = Readonly<{
    context: ObjectAnnotationContext;
    layoutRevision: string;
    areaPixels: number | null;
    currentAreaSquareMetres: number | null;
}>;

export function ObjectContextMenu({
    drawing,
    children,
    onAsk,
}: Readonly<{ drawing: Drawing; children: ReactNode; onAsk: (target: Pick<ObjectMenuTarget, 'context' | 'layoutRevision'>) => void }>) {
    const [adjustmentModel] = useState(() => createPpmAdjustmentModel(drawing.id));
    const [menuTarget, setMenuTarget] = useState<ObjectMenuTarget | null>(null);
    const targetFor = (target: EventTarget): ObjectMenuTarget | null => {
        if (!(target instanceof Element)) return null;
        const element = target.closest('[data-detected-object]');
        if (!element) return null;
        const pageNumber = Number(element.getAttribute('data-detected-page'));
        const index = Number(element.getAttribute('data-detected-index'));
        const blueprint = drawing.blueprints.find((item) => item.pageNumber === pageNumber);
        const property = layoutPages(drawing.blueprints).find((page) => page.page === pageNumber)?.detectedProperties[index];
        if (!blueprint?.layout || !property) return null;
        const context = objectAnnotationContext({ drawing, blueprintId: blueprint.id, entityId: property.id });
        if (!context) return null;
        const ppm = blueprint.ppm?.value;
        return {
            context,
            layoutRevision: blueprint.layout.revision,
            areaPixels: property.areaPixels,
            currentAreaSquareMetres:
                blueprint.ppm?.userCalibration?.entityId === property.id
                    ? blueprint.ppm.userCalibration.areaSquareMetres
                    : ppm && property.areaPixels !== null
                      ? property.areaPixels / (ppm * ppm)
                      : null,
        };
    };
    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger
                    captureContextMenu
                    className="contents"
                    filter={(target) => !!target.closest('[data-detected-object]')}
                    onPointerDownCapture={(event) => {
                        if (event.button === 2 && event.target instanceof Element && event.target.closest('[data-detected-object]')) event.stopPropagation();
                    }}
                    onContextMenu={(event) => {
                        if (!(event.target instanceof Element) || !event.target.closest('[data-detected-object]')) return;
                        event.stopPropagation();
                        setMenuTarget(targetFor(event.target));
                    }}
                    onKeyDown={(event) => {
                        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                        event.stopPropagation();
                        setMenuTarget(targetFor(event.target));
                    }}
                >
                    {children}
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <MenuItem
                        index={0}
                        label="Ask"
                        disabled={!menuTarget || drawing.busy}
                        onSelect={() => {
                            if (menuTarget && !drawing.busy) onAsk({ context: menuTarget.context, layoutRevision: menuTarget.layoutRevision });
                        }}
                    />
                    <MenuItem
                        index={1}
                        label="Adjust area"
                        disabled={!menuTarget || menuTarget.areaPixels === null || menuTarget.areaPixels <= 0 || drawing.busy}
                        onSelect={() => {
                            if (menuTarget && menuTarget.areaPixels !== null && menuTarget.areaPixels > 0 && !drawing.busy)
                                adjustmentModel.targetOpened({
                                    blueprintId: menuTarget.context.blueprintId,
                                    entityId: menuTarget.context.entityId,
                                    label: menuTarget.context.label,
                                    layoutRevision: menuTarget.layoutRevision,
                                    areaPixels: menuTarget.areaPixels,
                                    currentAreaSquareMetres: menuTarget.currentAreaSquareMetres,
                                });
                        }}
                    />
                </ContextMenuContent>
            </ContextMenu>
            <PpmAdjustmentDialog model={adjustmentModel} />
        </>
    );
}
