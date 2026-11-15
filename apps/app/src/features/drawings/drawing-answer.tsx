import { getDetectedObjectColor, type Answer, type AnswerBlock, type AnswerReference, type Drawing } from '@repo/types';
import { useUnit } from 'effector-react';
import { Banner, BannerDescription } from '@repo/design-system/components/ui/banner';
import { Button } from '@repo/design-system/components/ui/button';
import { ChatMarkdown } from './chat-markdown';
import { layerObjects } from './layout';
import { Trace } from '@repo/design-system/components/ui/trace';
import { ProgressStep } from './progress-step';
import { $$drawings } from './model';

function DrawingReferences({ drawing, references }: Readonly<{ drawing: Drawing; references: readonly AnswerReference[] }>) {
    const selectObject = useUnit($$drawings.canvasSelectionRequested);
    const objects = layerObjects(drawing.blueprints);
    const sheets = drawing.blueprints
        .filter((blueprint) => references.some((reference) => reference.blueprintId === blueprint.id))
        .sort((left, right) => left.pageNumber - right.pageNumber);
    const unavailableSheets = new Set(
        references
            .filter((reference) => !drawing.blueprints.some((blueprint) => blueprint.id === reference.blueprintId))
            .map((reference) => reference.blueprintId),
    );

    return (
        <div className="space-y-2" aria-label="Supporting drawing objects">
            <Trace>
                {sheets.map((blueprint) => {
                    const requested = references.filter((reference) => reference.blueprintId === blueprint.id);
                    const entityIds = new Set(requested.flatMap((reference) => (reference.entityId === null ? [] : [reference.entityId])));
                    const members = objects.filter((object) => object.page === blueprint.pageNumber && entityIds.has(object.property.id));
                    const missing = [...entityIds].filter((id) => !members.some((object) => object.property.id === id)).length;
                    return (
                        <ProgressStep
                            key={blueprint.id}
                            title={`Sheet ${blueprint.pageNumber}`}
                            status={undefined}
                            detail={entityIds.size ? `${entityIds.size} ${entityIds.size === 1 ? 'object' : 'objects'}` : 'Source'}
                        >
                            {(['room', 'icon', 'junction'] as const).flatMap((type) => {
                                const items = members.filter((object) => object.property.type === type);
                                return [...new Set(items.map((object) => object.property.label))]
                                    .sort((left, right) => left.localeCompare(right))
                                    .map((category) => {
                                        const group = items.filter((object) => object.property.label === category);
                                        return (
                                            <div key={`${type}:${category}`} className="space-y-1">
                                                <p className="flex items-center gap-2 text-xs font-medium">
                                                    <span
                                                        className="size-2 shrink-0"
                                                        style={{ backgroundColor: getDetectedObjectColor({ type, label: category }) }}
                                                        aria-hidden
                                                    />
                                                    {category}
                                                    <span className="text-muted-foreground">{group.length}</span>
                                                </p>
                                                <ul className="space-y-1">
                                                    {group.map((object) => (
                                                        <li key={object.property.id}>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-auto min-h-7 max-w-full whitespace-normal py-1 text-left"
                                                                disabled={blueprint.attachment.hiddenFromCanvas}
                                                                aria-label={`${object.name}, sheet ${blueprint.pageNumber}`}
                                                                title={
                                                                    blueprint.attachment.hiddenFromCanvas
                                                                        ? 'Restore this sheet to the canvas to select its objects.'
                                                                        : undefined
                                                                }
                                                                onClick={() => selectObject({ id: drawing.id, page: object.page, index: object.index })}
                                                            >
                                                                <span className="inline-flex items-center gap-2">
                                                                    <span
                                                                        className="size-2 shrink-0"
                                                                        style={{ backgroundColor: getDetectedObjectColor(object.property) }}
                                                                        aria-hidden
                                                                    />
                                                                    {object.name}
                                                                    {blueprint.attachment.hiddenFromCanvas && ' · Hidden from canvas'}
                                                                </span>
                                                            </Button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        );
                                    });
                            })}
                            {requested.some((reference) => reference.entityId === null) && <p className="text-xs text-muted-foreground">Sheet-wide evidence</p>}
                            {missing > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    {missing} {missing === 1 ? 'object unavailable' : 'objects unavailable'}
                                </p>
                            )}
                        </ProgressStep>
                    );
                })}
            </Trace>
            {unavailableSheets.size > 0 && (
                <p className="text-xs text-muted-foreground">
                    {unavailableSheets.size} {unavailableSheets.size === 1 ? 'drawing reference unavailable' : 'drawing references unavailable'}
                </p>
            )}
        </div>
    );
}

function DrawingAnswerBlock({ block, drawing }: Readonly<{ block: AnswerBlock; drawing: Drawing }>) {
    switch (block.type) {
        case 'text':
            return <ChatMarkdown>{block.text}</ChatMarkdown>;
        case 'entity_list':
            return (
                <div className="space-y-2">
                    {block.title && <p className="text-xs font-medium">{block.title}</p>}
                    <DrawingReferences drawing={drawing} references={block.items} />
                </div>
            );
        case 'entity_results':
            return (
                <div className="space-y-2">
                    <p className="text-xs font-medium">
                        {block.title} · {block.count} {block.count === 1 ? 'match' : 'matches'}
                    </p>
                    {block.count === 0 ? (
                        <p className="text-xs text-muted-foreground">No matching objects found.</p>
                    ) : (
                        <DrawingReferences drawing={drawing} references={block.items} />
                    )}
                </div>
            );
        case 'notice':
            return (
                <div>
                    <Banner status={block.tone} size="compact" role="note">
                        <BannerDescription className="row-start-1 mt-0">{block.text}</BannerDescription>
                    </Banner>
                </div>
            );
        default: {
            const exhaustive: never = block;
            return exhaustive;
        }
    }
}

export function DrawingAnswer({ answer, drawing }: Readonly<{ answer: Answer; drawing: Drawing }>) {
    const blocks = answer.presentation?.blocks;
    const listedEntities = blocks?.flatMap((block) => (block.type === 'entity_list' || block.type === 'entity_results' ? block.items : [])) ?? [];
    const resultSheets = new Set(blocks?.flatMap((block) => (block.type === 'entity_results' ? block.items.map((item) => item.blueprintId) : [])) ?? []);
    const references = answer.references.filter(
        (reference) =>
            (reference.entityId !== null || !resultSheets.has(reference.blueprintId)) &&
            !listedEntities.some((entity) => entity.blueprintId === reference.blueprintId && entity.entityId === reference.entityId),
    );

    return (
        <>
            {blocks ? (
                <div className="min-w-0 space-y-3">
                    {blocks.map((block, index) => (
                        <DrawingAnswerBlock key={index} block={block} drawing={drawing} />
                    ))}
                </div>
            ) : (
                <ChatMarkdown>{answer.text}</ChatMarkdown>
            )}
            {references.length > 0 && (
                <div className="mt-3">
                    <DrawingReferences drawing={drawing} references={references} />
                </div>
            )}
        </>
    );
}
