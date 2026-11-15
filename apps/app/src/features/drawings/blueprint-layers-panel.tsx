import { layoutPages, layerObjects } from './layout';
import { useEffect, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import { motion, useReducedMotion } from 'motion/react';
import { getDetectedObjectColor, type Drawing } from '@repo/types';
import { Button } from '@repo/design-system/components/ui/button';
import { Eye, EyeOff } from 'lucide-react';
import { spring } from '@repo/design-system/lib/springs';
import { remixIcons, Upload } from '@repo/design-system/lib/icons-remix';
import { DropdownMenu, DropdownTrigger, DropdownContent } from '@repo/design-system/components/ui/dropdown';
import { MenuItem } from '@repo/design-system/components/ui/menu-item';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@repo/design-system/components/ui/accordion';
import { DrawingUploads } from './drawing-uploads';
import type { CanvasModel } from './canvas/model';

function VisibilityToggle({ visible, label, onToggle }: Readonly<{ visible: boolean; label: string; onToggle: () => void }>) {
    const Icon = visible ? Eye : EyeOff;
    return (
        <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
            aria-pressed={visible}
            onClick={onToggle}
        >
            <Icon size={14} aria-hidden />
        </Button>
    );
}

const MoreIcon = remixIcons['more-horizontal'];
const CollapseIcon = remixIcons['panel-left'];

export function BlueprintLayersPanel({
    drawing,
    model,
    preview,
    onUpload,
    uploading,
}: Readonly<{ drawing: Drawing; model: CanvasModel; preview: boolean; onUpload?: () => void; uploading?: boolean }>) {
    const container = useRef<HTMLDivElement>(null);
    const reducedMotion = useReducedMotion();
    const [height, setHeight] = useState(600);
    const [collapsed, setCollapsed] = useState(false);
    const [collapsedSheets, setCollapsedSheets] = useState<string[]>([]);
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
    const expandGroups = (keys: string[]) => setOpenGroups((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, true])) }));
    const toggleGroup = (key: string, open: boolean) => setOpenGroups((current) => (current[key] === open ? current : { ...current, [key]: open }));
    const [width, setWidth] = useState(320);
    const { selection, visibility, hiddenObjects } = useUnit({
        selection: model.$selection,
        visibility: model.$visibility,
        hiddenObjects: model.$hiddenObjects,
    });
    useEffect(() => {
        const parent = container.current?.parentElement;
        if (!parent) return;
        const observer = new ResizeObserver(() => setHeight(parent.clientHeight));
        setHeight(parent.clientHeight);
        observer.observe(parent);
        return () => observer.disconnect();
    }, []);
    const rows = () =>
        Array.from(container.current?.querySelectorAll<HTMLButtonElement>('button[data-layer-page]') ?? []).filter(
            (row) => row.getClientRects().length > 0 && !row.disabled,
        );
    const selectRow = (row: HTMLButtonElement, range: boolean) => {
        const object = { page: Number(row.dataset.layerPage), index: Number(row.dataset.layerIndex) };
        const order = rows().map((item) => ({ page: Number(item.dataset.layerPage), index: Number(item.dataset.layerIndex) }));
        if (range) model.rangeSelected({ object, order });
        else model.selected(object);
        model.focusRequested(object);
    };
    const objects = layerObjects(drawing.blueprints);
    // Selection stays in the canvas model; expansion is local presentation state.
    const [revealedSelection, setRevealedSelection] = useState(selection);
    if (revealedSelection !== selection) {
        setRevealedSelection(selection);
        const added = selection.filter((item) => !revealedSelection.some((previous) => previous.page === item.page && previous.index === item.index));
        if (added.length) {
            const sheets = new Set<string>();
            const groups: Record<string, boolean> = {};
            for (const item of added) {
                const blueprint = drawing.blueprints.find((sheet) => sheet.pageNumber === item.page);
                const property = objects.find((object) => object.page === item.page && object.index === item.index)?.property;
                if (!blueprint || !property) continue;
                sheets.add(blueprint.id);
                groups[JSON.stringify([blueprint.id, property.type])] = true;
                groups[JSON.stringify([blueprint.id, property.type, property.label])] = true;
            }
            if (sheets.size) {
                setCollapsed(false);
                setCollapsedSheets((current) => current.filter((id) => !sheets.has(id)));
                setOpenGroups((current) => ({ ...current, ...groups }));
            }
        }
    }
    useEffect(() => {
        const selected = selection.at(-1);
        if (!selected) return;
        // Keep the row visible while its nested accordions finish opening, without moving keyboard focus.
        let frame = 0;
        const started = performance.now();
        const reveal = () => {
            const row = container.current?.querySelector<HTMLButtonElement>(`button[data-layer-page="${selected.page}"][data-layer-index="${selected.index}"]`);
            row?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
            if (performance.now() - started < 600) frame = requestAnimationFrame(reveal);
        };
        frame = requestAnimationFrame(reveal);
        return () => cancelAnimationFrame(frame);
    }, [selection]);
    const attachment = drawing.blueprints[0]?.attachment;
    const count = objects.length;
    return (
        <motion.div
            ref={container}
            className="relative shrink-0 max-md:absolute max-md:right-0 max-md:top-0 max-md:h-full"
            initial={false}
            animate={{ width: collapsed ? 0 : width }}
            transition={reducedMotion ? { duration: 0 } : spring.slow}
        >
            <motion.aside
                aria-label="Blueprints sidebar"
                className="absolute right-0 top-0 z-20 max-w-[calc(100vw-16px)] p-2"
                style={{ width }}
                initial={false}
                animate={{ height: collapsed ? 98 : height }}
                transition={reducedMotion ? { duration: 0 } : spring.slow}
            >
                <div className="flex h-full min-h-0 flex-col overflow-hidden border border-border bg-card">
                    <header className="flex min-h-20 shrink-0 items-center gap-2 px-4">
                        <div className="min-w-0 flex-1">
                            <h2 className="text-sm font-medium">Blueprints</h2>
                            <p className="mt-2 text-xs text-muted-foreground">
                                {attachment ? `${drawing.blueprints.length} blueprints · ${count} elements` : 'No blueprints yet'}
                            </p>
                        </div>
                        <DropdownMenu>
                            <DropdownTrigger
                                render={
                                    <Button variant="ghost" size="icon" aria-label="Blueprint actions" disabled={preview || uploading}>
                                        <MoreIcon />
                                    </Button>
                                }
                            />
                            <DropdownContent align="end">
                                <MenuItem index={0} icon={Upload} label="Upload documents" onSelect={onUpload} />
                            </DropdownContent>
                        </DropdownMenu>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label={collapsed ? 'Expand blueprints' : 'Collapse blueprints'}
                            aria-expanded={!collapsed}
                            onClick={() => setCollapsed(!collapsed)}
                        >
                            <CollapseIcon size={16} className="rotate-180" aria-hidden />
                        </Button>
                    </header>
                    <div
                        inert={collapsed}
                        aria-hidden={collapsed}
                        className="min-h-0 flex-1 overflow-y-auto border-t"
                        style={{ visibility: collapsed ? 'hidden' : 'visible' }}
                    >
                        {drawing.blueprints.map((blueprint) => {
                            const pages = layoutPages([blueprint]);
                            const sheetObjects = objects.filter((object) => object.page === blueprint.pageNumber);
                            const count = pages.reduce((total, page) => total + page.detectedProperties.length, 0);
                            const processing = blueprint.status.type === 'processing' && blueprint.status.stage === 'inference';
                            const failed = blueprint.status.type === 'failed' ? blueprint : null;
                            const expanded = !collapsedSheets.includes(blueprint.id);
                            return (
                                <Accordion key={blueprint.id} value={expanded ? 'sheet' : ''}>
                                    <AccordionItem value="sheet" highlight="trigger">
                                        <p className="px-4 pt-3 text-xs text-muted-foreground">Sheet {blueprint.pageNumber}</p>
                                        <DrawingUploads
                                            drawing={{ ...drawing, blueprints: [blueprint] }}
                                            preview={preview}
                                            expanded={expanded}
                                            onFocus={() => {
                                                setCollapsedSheets((current) => current.filter((id) => id !== blueprint.id));
                                                expandGroups(
                                                    pages.flatMap((page) =>
                                                        page.detectedProperties.flatMap((property) => [
                                                            JSON.stringify([blueprint.id, property.type]),
                                                            JSON.stringify([blueprint.id, property.type, property.label]),
                                                        ]),
                                                    ),
                                                );
                                                model.groupSelected({
                                                    page: blueprint.pageNumber,
                                                    objects: pages.flatMap((page) => page.detectedProperties.map((_, index) => ({ page: page.page, index }))),
                                                });
                                            }}
                                            onToggle={() =>
                                                setCollapsedSheets((current) =>
                                                    expanded ? [...current, blueprint.id] : current.filter((id) => id !== blueprint.id),
                                                )
                                            }
                                        />
                                        <AccordionContent aria-label={`Sheet ${blueprint.pageNumber} elements`} className="[&>div]:p-0">
                                            <div>
                                                {processing && (
                                                    <p role="status" className="px-4 pb-3 text-sm text-muted-foreground">
                                                        Finding elements…
                                                    </p>
                                                )}
                                                {failed && (
                                                    <p role="alert" className="px-4 pb-3 text-sm text-destructive">
                                                        {failed.status.type === 'failed'
                                                            ? failed.status.error
                                                            : 'Element detection failed. Your blueprint is still available.'}
                                                    </p>
                                                )}
                                                {!count && !processing && <p className="px-4 pb-3 text-sm text-muted-foreground">No detected elements yet.</p>}
                                                {(['room', 'icon', 'junction'] as const).map((type) => {
                                                    const items = sheetObjects.filter((item) => item.property.type === type);
                                                    if (!items.length) return null;
                                                    return (
                                                        <div key={type} className="relative">
                                                            <div className="absolute right-2 top-1 z-10">
                                                                <VisibilityToggle
                                                                    visible={
                                                                        visibility[type] &&
                                                                        items.some((item) => !hiddenObjects.includes(`${item.page}:${item.index}`))
                                                                    }
                                                                    label={type === 'room' ? 'rooms' : type === 'icon' ? 'fixtures' : 'junctions'}
                                                                    onToggle={() => {
                                                                        const visible =
                                                                            visibility[type] &&
                                                                            items.some((item) => !hiddenObjects.includes(`${item.page}:${item.index}`));
                                                                        if (!visible && !visibility[type]) model.visibilityChanged({ type, visible: true });
                                                                        for (const { page, index } of items)
                                                                            model.objectVisibilityChanged({ object: { page, index }, visible: !visible });
                                                                    }}
                                                                />
                                                            </div>
                                                            <Accordion
                                                                value={(openGroups[JSON.stringify([blueprint.id, type])] ?? true) ? 'group' : ''}
                                                                onValueChange={(value: string) =>
                                                                    toggleGroup(JSON.stringify([blueprint.id, type]), value === 'group')
                                                                }
                                                            >
                                                                <AccordionItem value="group" highlight="trigger">
                                                                    <AccordionTrigger
                                                                        onClick={(event) => {
                                                                            if (event.shiftKey) {
                                                                                event.preventDefault();
                                                                                expandGroups([
                                                                                    JSON.stringify([blueprint.id, type]),
                                                                                    ...items.map((item) =>
                                                                                        JSON.stringify([blueprint.id, type, item.property.label]),
                                                                                    ),
                                                                                ]);
                                                                                model.groupSelected({
                                                                                    page: blueprint.pageNumber,
                                                                                    objects: items.map(({ page, index }) => ({ page, index })),
                                                                                });
                                                                            }
                                                                        }}
                                                                        className="cursor-pointer pl-4 pr-12 py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring"
                                                                    >
                                                                        <span className="ml-1">
                                                                            {type === 'room' ? 'Rooms' : type === 'icon' ? 'Fixtures' : 'Junctions'}
                                                                        </span>{' '}
                                                                        <span className="ml-2 text-muted-foreground">{items.length}</span>
                                                                    </AccordionTrigger>
                                                                    <AccordionContent className="[&>div]:p-0">
                                                                        {[...new Set(items.map((item) => item.property.label))]
                                                                            .sort((a, b) => a.localeCompare(b))
                                                                            .map((category) => {
                                                                                const members = items.filter((item) => item.property.label === category);
                                                                                const visible =
                                                                                    visibility[type] &&
                                                                                    members.some(
                                                                                        (item) => !hiddenObjects.includes(`${item.page}:${item.index}`),
                                                                                    );
                                                                                return (
                                                                                    <div key={category} className="relative">
                                                                                        <div className="absolute right-2 top-1 z-10">
                                                                                            <VisibilityToggle
                                                                                                visible={visible}
                                                                                                label={`${category} category`}
                                                                                                onToggle={() => {
                                                                                                    if (!visible && !visibility[type])
                                                                                                        model.visibilityChanged({ type, visible: true });
                                                                                                    for (const { page, index } of members)
                                                                                                        model.objectVisibilityChanged({
                                                                                                            object: { page, index },
                                                                                                            visible: !visible,
                                                                                                        });
                                                                                                }}
                                                                                            />
                                                                                        </div>
                                                                                        <Accordion
                                                                                            value={
                                                                                                (openGroups[JSON.stringify([blueprint.id, type, category])] ??
                                                                                                false)
                                                                                                    ? 'category'
                                                                                                    : ''
                                                                                            }
                                                                                            onValueChange={(value: string) =>
                                                                                                toggleGroup(
                                                                                                    JSON.stringify([blueprint.id, type, category]),
                                                                                                    value === 'category',
                                                                                                )
                                                                                            }
                                                                                        >
                                                                                            <AccordionItem value="category" highlight="trigger">
                                                                                                <AccordionTrigger
                                                                                                    onClick={(event) => {
                                                                                                        if (event.shiftKey) {
                                                                                                            event.preventDefault();
                                                                                                            expandGroups([
                                                                                                                JSON.stringify([blueprint.id, type]),
                                                                                                                JSON.stringify([blueprint.id, type, category]),
                                                                                                            ]);
                                                                                                            model.groupSelected({
                                                                                                                page: blueprint.pageNumber,
                                                                                                                objects: members.map(({ page, index }) => ({
                                                                                                                    page,
                                                                                                                    index,
                                                                                                                })),
                                                                                                            });
                                                                                                        }
                                                                                                    }}
                                                                                                    className="cursor-pointer py-3 pl-6 pr-12 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring"
                                                                                                >
                                                                                                    <span
                                                                                                        className="ml-1 mr-2 inline-block size-2"
                                                                                                        style={{
                                                                                                            backgroundColor: getDetectedObjectColor({
                                                                                                                type,
                                                                                                                label: category,
                                                                                                            }),
                                                                                                        }}
                                                                                                        aria-hidden
                                                                                                    />
                                                                                                    {category}
                                                                                                    <span className="ml-2 text-muted-foreground">
                                                                                                        {members.length}
                                                                                                    </span>
                                                                                                </AccordionTrigger>
                                                                                                <AccordionContent className="[&>div]:p-0">
                                                                                                    <ul className="pb-2">
                                                                                                        {members.map(
                                                                                                            ({
                                                                                                                property,
                                                                                                                page,
                                                                                                                index,
                                                                                                                number,
                                                                                                                name: objectName,
                                                                                                            }) => {
                                                                                                                const selected = selection.some(
                                                                                                                    (item) =>
                                                                                                                        item.page === page &&
                                                                                                                        item.index === index,
                                                                                                                );
                                                                                                                return (
                                                                                                                    <li
                                                                                                                        key={`${page}:${index}`}
                                                                                                                        className="flex items-center pr-2"
                                                                                                                    >
                                                                                                                        <button
                                                                                                                            type="button"
                                                                                                                            disabled={
                                                                                                                                drawing.blueprints.find(
                                                                                                                                    (blueprint) =>
                                                                                                                                        blueprint.pageNumber ===
                                                                                                                                        page,
                                                                                                                                )?.attachment.hiddenFromCanvas
                                                                                                                            }
                                                                                                                            aria-pressed={selected}
                                                                                                                            data-layer-page={page}
                                                                                                                            data-layer-index={index}
                                                                                                                            onKeyDown={(event) => {
                                                                                                                                if (
                                                                                                                                    ![
                                                                                                                                        'ArrowUp',
                                                                                                                                        'ArrowDown',
                                                                                                                                        'Home',
                                                                                                                                        'End',
                                                                                                                                    ].includes(event.key)
                                                                                                                                )
                                                                                                                                    return;
                                                                                                                                event.preventDefault();
                                                                                                                                const visibleRows = rows();
                                                                                                                                const current =
                                                                                                                                    visibleRows.indexOf(
                                                                                                                                        event.currentTarget,
                                                                                                                                    );
                                                                                                                                const next =
                                                                                                                                    event.key === 'Home'
                                                                                                                                        ? 0
                                                                                                                                        : event.key === 'End'
                                                                                                                                          ? visibleRows.length -
                                                                                                                                            1
                                                                                                                                          : Math.max(
                                                                                                                                                0,
                                                                                                                                                Math.min(
                                                                                                                                                    visibleRows.length -
                                                                                                                                                        1,
                                                                                                                                                    current +
                                                                                                                                                        (event.key ===
                                                                                                                                                        'ArrowDown'
                                                                                                                                                            ? 1
                                                                                                                                                            : -1),
                                                                                                                                                ),
                                                                                                                                            );
                                                                                                                                const row = visibleRows[next];
                                                                                                                                if (!row) return;
                                                                                                                                row.focus({
                                                                                                                                    preventScroll: true,
                                                                                                                                });
                                                                                                                                row.scrollIntoView({
                                                                                                                                    block: 'nearest',
                                                                                                                                });
                                                                                                                                selectRow(row, event.shiftKey);
                                                                                                                            }}
                                                                                                                            className="flex min-w-0 flex-1 items-center gap-2 pl-10 pr-1 py-2 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-50 aria-pressed:bg-accent/50 aria-pressed:text-foreground"
                                                                                                                            onClick={(event) => {
                                                                                                                                if (!visibility[type])
                                                                                                                                    model.visibilityChanged({
                                                                                                                                        type,
                                                                                                                                        visible: true,
                                                                                                                                    });
                                                                                                                                const object = { page, index };
                                                                                                                                model.objectVisibilityChanged({
                                                                                                                                    object,
                                                                                                                                    visible: true,
                                                                                                                                });
                                                                                                                                selectRow(
                                                                                                                                    event.currentTarget,
                                                                                                                                    event.shiftKey,
                                                                                                                                );
                                                                                                                            }}
                                                                                                                        >
                                                                                                                            <span
                                                                                                                                className="size-2 shrink-0"
                                                                                                                                style={{
                                                                                                                                    backgroundColor:
                                                                                                                                        getDetectedObjectColor(
                                                                                                                                            property,
                                                                                                                                        ),
                                                                                                                                }}
                                                                                                                                aria-hidden
                                                                                                                            />
                                                                                                                            <span className="min-w-0 flex-1 truncate">
                                                                                                                                {property.label}{' '}
                                                                                                                                <span
                                                                                                                                    className={
                                                                                                                                        selected
                                                                                                                                            ? 'text-foreground'
                                                                                                                                            : 'text-muted-foreground'
                                                                                                                                    }
                                                                                                                                >
                                                                                                                                    {number} · Sheet {page}
                                                                                                                                </span>
                                                                                                                            </span>
                                                                                                                        </button>
                                                                                                                        <VisibilityToggle
                                                                                                                            visible={
                                                                                                                                visibility[type] &&
                                                                                                                                !hiddenObjects.includes(
                                                                                                                                    `${page}:${index}`,
                                                                                                                                )
                                                                                                                            }
                                                                                                                            label={`${objectName}, sheet ${page}`}
                                                                                                                            onToggle={() => {
                                                                                                                                const visible =
                                                                                                                                    !visibility[type] ||
                                                                                                                                    hiddenObjects.includes(
                                                                                                                                        `${page}:${index}`,
                                                                                                                                    );
                                                                                                                                if (
                                                                                                                                    visible &&
                                                                                                                                    !visibility[type]
                                                                                                                                )
                                                                                                                                    model.visibilityChanged({
                                                                                                                                        type,
                                                                                                                                        visible: true,
                                                                                                                                    });
                                                                                                                                model.objectVisibilityChanged({
                                                                                                                                    object: { page, index },
                                                                                                                                    visible,
                                                                                                                                });
                                                                                                                            }}
                                                                                                                        />
                                                                                                                    </li>
                                                                                                                );
                                                                                                            },
                                                                                                        )}
                                                                                                    </ul>
                                                                                                </AccordionContent>
                                                                                            </AccordionItem>
                                                                                        </Accordion>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                    </AccordionContent>
                                                                </AccordionItem>
                                                            </Accordion>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>
                            );
                        })}
                    </div>
                </div>
                {!collapsed && (
                    <div
                        role="separator"
                        tabIndex={0}
                        aria-label="Resize blueprints sidebar"
                        aria-orientation="vertical"
                        aria-valuemin={280}
                        aria-valuemax={600}
                        aria-valuenow={width}
                        className="absolute bottom-2 left-0 top-2 w-2 cursor-col-resize touch-none hover:bg-border focus-visible:bg-border focus-visible:outline-none"
                        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
                        onPointerMove={(event) => {
                            if (event.currentTarget.hasPointerCapture(event.pointerId))
                                setWidth(Math.max(280, Math.min(600, (event.currentTarget.parentElement?.getBoundingClientRect().right ?? 0) - event.clientX)));
                        }}
                        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
                        onKeyDown={(event) => {
                            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                                event.preventDefault();
                                setWidth((current) => Math.max(280, Math.min(600, current + (event.key === 'ArrowLeft' ? 16 : -16))));
                            }
                        }}
                    />
                )}
            </motion.aside>
        </motion.div>
    );
}
