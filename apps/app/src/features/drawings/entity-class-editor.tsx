import { useId } from 'react';
import { useForm } from '@tanstack/react-form';
import { useUnit } from 'effector-react';
import { LayoutRoomZod, LayoutFixtureZod, UpdateEntityClassZod, type Drawing, type Blueprint, type DetectedProperty } from '@repo/types';
import { Button } from '@repo/design-system/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem } from '@repo/design-system/components/ui/select';
import type { CanvasModel } from './canvas/model';
import { DetectedElementCard } from './detected-element-card';
import { formatDetectedObjectArea } from './detected-object-tooltip';
import { predictionPage } from './layout';

function ClassForm({
    drawing,
    blueprint,
    property,
    model,
}: Readonly<{ drawing: Drawing; blueprint: Blueprint; property: DetectedProperty; model: CanvasModel }>) {
    const labelId = useId();
    const { pending, result } = useUnit({ pending: model.$classPending, result: model.$classResult });
    const form = useForm({
        defaultValues: { class: property.label },
        onSubmit: async ({ value }) => {
            const input = UpdateEntityClassZod.parse({
                id: drawing.id,
                blueprintId: blueprint.id,
                revision: blueprint.layout?.revision,
                entityId: property.id,
                kind: property.type === 'room' ? 'room' : 'fixture',
                class: value.class,
            });
            // The model retains request failures; keep the form value available for retry.
            await model.updateEntityClassFx(input).catch(() => undefined);
        },
    });
    const classes = property.type === 'room' ? LayoutRoomZod.shape.class.options : LayoutFixtureZod.shape.class.options;
    return (
        <form
            className="mt-3 space-y-2 border-t pt-3"
            onSubmit={(event) => {
                event.preventDefault();
                void form.handleSubmit();
            }}
        >
            <form.Field name="class">
                {(field) => (
                    <div className="space-y-1.5">
                        <p id={labelId} className="text-xs font-medium text-muted-foreground">
                            Class
                        </p>
                        <Select value={field.state.value} onValueChange={field.handleChange} disabled={pending || drawing.busy}>
                            <SelectTrigger aria-labelledby={labelId} onBlur={field.handleBlur} className="w-full" />
                            <SelectContent>
                                {classes.map((label, index) => (
                                    <SelectItem key={label} index={index} value={label}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </form.Field>
            <form.Subscribe selector={(state) => state.values.class}>
                {(value) => (
                    <Button type="submit" size="compact" loading={pending} disabled={drawing.busy || pending || value === property.label}>
                        Save class
                    </Button>
                )}
            </form.Subscribe>
            {drawing.busy && <p className="text-xs text-muted-foreground">Class editing is available when processing finishes.</p>}
            {result.type === 'error' && result.blueprintId === blueprint.id && result.entityId === property.id && (
                <p role="alert" className="text-xs text-destructive">
                    {result.message}
                </p>
            )}
            {result.type === 'saved' && result.blueprintId === blueprint.id && result.entityId === property.id && (
                <p role="status" className="text-xs text-muted-foreground">
                    Class saved.
                </p>
            )}
        </form>
    );
}

export function EntityClassEditor({ drawing, model, preview }: Readonly<{ drawing: Drawing; model: CanvasModel; preview: boolean }>) {
    const selection = useUnit(model.$selection);
    if (preview || selection.length !== 1) return null;
    const selected = selection[0];
    const blueprint = drawing.blueprints.find((item) => item.pageNumber === selected.page && !item.attachment.hiddenFromCanvas);
    const page = blueprint ? predictionPage(blueprint) : null;
    const property = page?.detectedProperties[selected.index];
    if (!blueprint || !page || !property || property.type === 'junction') return null;
    const entity =
        property.type === 'room'
            ? blueprint.layout?.rooms.find((item) => item.id === property.id)
            : blueprint.layout?.fixtures.find((item) => item.id === property.id);
    return (
        <div className="pointer-events-auto absolute bottom-4 left-4 right-4 z-20 sm:left-auto sm:right-80 sm:w-80">
            <DetectedElementCard
                label={property.label}
                area={formatDetectedObjectArea({ drawing, page, property, index: selected.index })}
                enrichment={entity?.enrichment}
                onClose={() => model.selected(null)}
            >
                <ClassForm key={`${blueprint.id}:${property.id}`} drawing={drawing} blueprint={blueprint} property={property} model={model} />
            </DetectedElementCard>
        </div>
    );
}
