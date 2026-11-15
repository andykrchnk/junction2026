import { useState, type ReactNode } from 'react';
import type { Drawing } from '@repo/types';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent } from '@repo/design-system/components/ui/context-menu';
import { MenuItem } from '@repo/design-system/components/ui/menu-item';
import { layoutPages } from './layout';
import { createPpmAdjustmentModel, type PpmAdjustmentTarget } from './ppm-adjustment-model';
import { PpmAdjustmentDialog } from './ppm-adjustment-dialog';

export function PpmAdjustmentMenu({ drawing, children }: Readonly<{ drawing: Drawing; children: ReactNode }>) {
    const [adjustmentModel] = useState(() => createPpmAdjustmentModel(drawing.id));
    const [menuTarget, setMenuTarget] = useState<PpmAdjustmentTarget | null>(null);
    const targetFor = (target: EventTarget): PpmAdjustmentTarget | null => {
        if (!(target instanceof Element)) return null;
        const element = target.closest('[data-detected-object]');
        if (!element) return null;
        const pageNumber = Number(element.getAttribute('data-detected-page'));
        const index = Number(element.getAttribute('data-detected-index'));
        const blueprint = drawing.blueprints.find((item) => item.pageNumber === pageNumber);
        const property = layoutPages(drawing.blueprints).find((page) => page.page === pageNumber)?.detectedProperties[index];
        if (!blueprint?.layout || !property || property.areaPixels === null || !Number.isFinite(property.areaPixels) || property.areaPixels <= 0) return null;
        const ppm = blueprint.ppm?.value;
        return {
            blueprintId: blueprint.id,
            entityId: property.id,
            layoutRevision: blueprint.layout.revision,
            label: property.label,
            areaPixels: property.areaPixels,
            currentAreaSquareMetres:
                blueprint.ppm?.userCalibration?.entityId === property.id
                    ? blueprint.ppm.userCalibration.areaSquareMetres
                    : ppm
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
                        label="Adjust PPM"
                        disabled={!menuTarget || drawing.busy}
                        onSelect={() => {
                            if (menuTarget && !drawing.busy) adjustmentModel.targetOpened(menuTarget);
                        }}
                    />
                </ContextMenuContent>
            </ContextMenu>
            <PpmAdjustmentDialog model={adjustmentModel} />
        </>
    );
}
