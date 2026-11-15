import { useState, type ReactNode } from 'react';
import { useUnit } from 'effector-react';
import type { Drawing } from '@repo/types';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent } from '@repo/design-system/components/ui/context-menu';
import { MessageSquare, ScanLine, Trash2 } from '@repo/design-system/lib/icons-remix';
import { MenuItem } from '@repo/design-system/components/ui/menu-item';
import { DetectedElementCard } from './detected-element-card';
import { EntityClassMenu } from './entity-class-menu';
import { formatDetectedObjectArea } from './detected-object-tooltip';
import type { CanvasModel } from './canvas/model';
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
    model,
    preview,
}: Readonly<{
    drawing: Drawing;
    model: CanvasModel;
    preview: boolean;
    children: ReactNode;
    onAsk: (target: Pick<ObjectMenuTarget, 'context' | 'layoutRevision'>) => void;
}>) {
    const { deleting, deleteError, deleteEntity, classPending } = useUnit({
        deleting: model.$deletingEntity,
        deleteError: model.$deleteError,
        deleteEntity: model.deleteEntityFx,
        classPending: model.$classPending,
    });
    const [open, setOpen] = useState(false);
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
    const blueprint = drawing.blueprints.find((item) => item.id === menuTarget?.context.blueprintId && !item.attachment.hiddenFromCanvas);
    const page = layoutPages(drawing.blueprints).find((item) => item.page === blueprint?.pageNumber);
    const index = page?.detectedProperties.findIndex((item) => item.id === menuTarget?.context.entityId) ?? -1;
    const property = page?.detectedProperties[index];
    const entity =
        property?.type === 'room'
            ? blueprint?.layout?.rooms.find((item) => item.id === property.id)
            : blueprint?.layout?.fixtures.find((item) => item.id === property?.id);
    const slab = property?.type === 'slab' ? blueprint?.layout?.slabs.find((item) => item.id === property.id) : null;
    const thickness = slab?.measurements.thickness;
    return (
        <>
            <ContextMenu open={open && !!property} onOpenChange={setOpen}>
                <ContextMenuTrigger
                    captureContextMenu
                    captureActivation
                    openOnClick
                    className="contents"
                    filter={(target) => !!target.closest('[data-detected-object]') && !target.closest('[data-comment-mode="comment"]')}
                    onPointerDownCapture={(event) => {
                        if (event.button === 2 && event.target instanceof Element && event.target.closest('[data-detected-object]')) event.stopPropagation();
                    }}
                    onClick={(event) => {
                        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
                        setMenuTarget(targetFor(event.target));
                    }}
                    onContextMenu={(event) => {
                        if (!(event.target instanceof Element) || !event.target.closest('[data-detected-object]')) return;
                        event.stopPropagation();
                        setMenuTarget(targetFor(event.target));
                    }}
                    onKeyDown={(event) => {
                        if (
                            !(event.target instanceof Element) ||
                            !event.target.closest('[data-detected-object]') ||
                            event.target.closest('[data-comment-mode="comment"]')
                        )
                            return;
                        if (
                            event.key !== 'ContextMenu' &&
                            !(event.shiftKey && event.key === 'F10') &&
                            !(!event.shiftKey && (event.key === 'Enter' || event.key === ' '))
                        )
                            return;
                        event.stopPropagation();
                        const target = targetFor(event.target);
                        setMenuTarget(target);
                        if (target && target.context.element !== null && !event.shiftKey)
                            model.selected({ page: target.context.sheet, index: target.context.element - 1 });
                    }}
                >
                    {children}
                </ContextMenuTrigger>
                <ContextMenuContent className="w-80 max-w-[calc(100vw-1rem)]">
                    {property && page && (
                        <DetectedElementCard
                            label={property.label}
                            area={formatDetectedObjectArea({ drawing, page, property, index })}
                            enrichment={entity?.enrichment}
                            onClose={() => setOpen(false)}
                        >
                            {slab && (
                                <div className="mt-3 space-y-2 border-t pt-3 text-xs">
                                    <p className="font-medium">Needs review</p>
                                    <p>Thickness: {thickness ? `${thickness.value} ${thickness.unit ?? '(unit unspecified)'}` : 'Not available'}</p>
                                    {slab.thickness_annotation && <p className="text-muted-foreground">Drawing note: {slab.thickness_annotation}</p>}
                                </div>
                            )}
                        </DetectedElementCard>
                    )}
                    <MenuItem
                        index={0}
                        label="Ask"
                        icon={MessageSquare}
                        disabled={preview || !menuTarget || drawing.busy || deleting}
                        onSelect={() => {
                            if (menuTarget && blueprint?.layout && property && !preview && !drawing.busy)
                                onAsk({ context: { ...menuTarget.context, label: property.label }, layoutRevision: blueprint.layout.revision });
                        }}
                    />
                    {blueprint && property && (property.type === 'room' || property.type === 'icon') && (
                        <EntityClassMenu
                            drawing={drawing}
                            blueprint={blueprint}
                            property={property}
                            model={model}
                            disabled={preview || drawing.busy || deleting}
                        />
                    )}
                    <MenuItem
                        index={2}
                        label="Adjust area"
                        icon={ScanLine}
                        disabled={preview || !menuTarget || menuTarget.areaPixels === null || menuTarget.areaPixels <= 0 || drawing.busy || deleting}
                        onSelect={() => {
                            if (
                                menuTarget &&
                                blueprint?.layout &&
                                property &&
                                menuTarget.areaPixels !== null &&
                                menuTarget.areaPixels > 0 &&
                                !preview &&
                                !drawing.busy
                            )
                                adjustmentModel.targetOpened({
                                    blueprintId: menuTarget.context.blueprintId,
                                    entityId: menuTarget.context.entityId,
                                    label: property.label,
                                    layoutRevision: blueprint.layout.revision,
                                    areaPixels: menuTarget.areaPixels,
                                    currentAreaSquareMetres: menuTarget.currentAreaSquareMetres,
                                });
                        }}
                    />
                    <MenuItem
                        index={3}
                        label={
                            deleting ? 'Deleting…' : property?.type === 'room' ? 'Delete room' : property?.type === 'slab' ? 'Delete slab' : 'Delete fixture'
                        }
                        icon={Trash2}
                        destructive
                        closeOnClick={false}
                        disabled={preview || !blueprint?.layout || !property || drawing.busy || deleting || classPending}
                        onSelect={() => {
                            if (!blueprint?.layout || !property || drawing.busy || deleting || classPending || preview) return;
                            void deleteEntity({
                                input: {
                                    id: drawing.id,
                                    blueprintId: blueprint.id,
                                    revision: blueprint.layout.revision,
                                    entityId: property.id,
                                    kind: property.type === 'room' ? 'room' : property.type === 'slab' ? 'slab' : 'fixture',
                                },
                                object: { page: blueprint.pageNumber, index },
                            }).catch(() => undefined); // The model exposes failures for retry in this menu.
                        }}
                    />
                    {deleteError && deleteError.blueprintId === blueprint?.id && deleteError.entityId === property?.id && (
                        <p role="alert" className="px-3 py-2 text-xs text-destructive">
                            {deleteError.message}
                        </p>
                    )}
                </ContextMenuContent>
            </ContextMenu>
            <PpmAdjustmentDialog model={adjustmentModel} />
        </>
    );
}
