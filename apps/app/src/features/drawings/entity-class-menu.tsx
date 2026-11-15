import { useUnit } from 'effector-react';
import {
    getDetectedObjectColor,
    LayoutRoomZod,
    LayoutFixtureZod,
    UpdateEntityClassZod,
    type Drawing,
    type Blueprint,
    type DetectedProperty,
} from '@repo/types';
import { DropdownSub, DropdownSubTrigger, DropdownSubContent } from '@repo/design-system/components/ui/dropdown';
import { MenuItem } from '@repo/design-system/components/ui/menu-item';
import type { CanvasModel } from './canvas/model';

export function EntityClassMenu({
    drawing,
    blueprint,
    property,
    model,
    disabled,
}: Readonly<{ drawing: Drawing; blueprint: Blueprint; property: DetectedProperty; model: CanvasModel; disabled: boolean }>) {
    const { pending, result, updateClass } = useUnit({ pending: model.$classPending, result: model.$classResult, updateClass: model.updateEntityClassFx });
    const classes = property.type === 'room' ? LayoutRoomZod.shape.class.options : LayoutFixtureZod.shape.class.options;
    return (
        <>
            <DropdownSub>
                <DropdownSubTrigger
                    index={1}
                    label={pending ? 'Saving class…' : property.label}
                    icon={() => <span aria-hidden className="size-2" style={{ backgroundColor: getDetectedObjectColor(property) }} />}
                    disabled={disabled || pending}
                />
                <DropdownSubContent className="max-w-[calc(100vw-2rem)]" checkedIndex={classes.findIndex((label) => label === property.label)}>
                    {classes.map((label, index) => (
                        <MenuItem
                            key={label}
                            index={index}
                            label={label}
                            icon={() => (
                                <span aria-hidden className="size-2" style={{ backgroundColor: getDetectedObjectColor({ type: property.type, label }) }} />
                            )}
                            checked={label === property.label}
                            closeOnClick={false}
                            disabled={disabled || pending || label === property.label}
                            onSelect={() => {
                                const input = UpdateEntityClassZod.parse({
                                    id: drawing.id,
                                    blueprintId: blueprint.id,
                                    revision: blueprint.layout?.revision,
                                    entityId: property.id,
                                    kind: property.type === 'room' ? 'room' : 'fixture',
                                    class: label,
                                });
                                // The model retains failures so the menu can show the error and offer a retry.
                                void updateClass(input).catch(() => undefined);
                            }}
                        />
                    ))}
                </DropdownSubContent>
            </DropdownSub>
            {drawing.busy && <p className="px-3 py-2 text-xs text-muted-foreground">Class editing is available when processing finishes.</p>}
            {result.type === 'error' && result.blueprintId === blueprint.id && result.entityId === property.id && (
                <p role="alert" className="px-3 py-2 text-xs text-destructive">
                    {result.message}
                </p>
            )}
        </>
    );
}
