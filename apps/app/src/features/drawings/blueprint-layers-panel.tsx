import { layoutPages } from './layout';
import { useEffect, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import { motion, useReducedMotion } from 'motion/react';
import { getDetectedObjectColor, type Drawing } from '@repo/types';
import { Button } from '@repo/design-system/components/ui/button';
import { Eye, EyeOff } from 'lucide-react';
import { spring } from '@repo/design-system/lib/springs';
import { remixIcons } from '@repo/design-system/lib/icons-remix';
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

const CollapseIcon = remixIcons['panel-left'];

export function BlueprintLayersPanel({ drawing, model, preview }: Readonly<{ drawing: Drawing; model: CanvasModel; preview: boolean }>) {
    const container = useRef<HTMLDivElement>(null);
    const reducedMotion = useReducedMotion();
    const [height, setHeight] = useState(600);
    const [collapsed, setCollapsed] = useState(false);
    const [expanded, setExpanded] = useState(true);
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
    const pages = layoutPages(drawing.blueprints);
    const attachment = drawing.blueprints[0]?.attachment;
    const processing = drawing.blueprints.some((blueprint) => blueprint.status.type === 'processing' && blueprint.status.stage === 'inference');
    const failed = drawing.blueprints.find((blueprint) => blueprint.status.type === 'failed' && blueprint.status.stage === 'inference');
    const count = pages.reduce((total, page) => total + page.detectedProperties.length, 0);
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
                            <p className="mt-2 text-xs text-muted-foreground">{attachment ? `1 blueprint · ${count} elements` : 'No blueprints yet'}</p>
                        </div>
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
                        <DrawingUploads drawing={drawing} preview={preview} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
                        {attachment && expanded && (
                            <div>
                                {attachment.hiddenFromCanvas && (
                                    <p className="px-4 pb-3 text-xs text-muted-foreground">Restore this blueprint to navigate its elements.</p>
                                )}
                                {processing && (
                                    <p role="status" className="px-4 pb-3 text-sm text-muted-foreground">
                                        Finding elements…
                                    </p>
                                )}
                                {failed && (
                                    <p role="alert" className="px-4 pb-3 text-sm text-destructive">
                                        {failed.status.type === 'failed' ? failed.status.error : 'Element detection failed. Your blueprint is still available.'}
                                    </p>
                                )}
                                {!count && !processing && <p className="px-4 pb-3 text-sm text-muted-foreground">No detected elements yet.</p>}
                                {(['room', 'icon', 'junction'] as const).map((type) => {
                                    const items = pages
                                        .flatMap((page) => page.detectedProperties.map((property, index) => ({ property, index, page: page.page })))
                                        .filter((item) => item.property.type === type);
                                    if (!items.length) return null;
                                    return (
                                        <div key={type} className="relative">
                                            <div className="absolute right-2 top-1 z-10">
                                                <VisibilityToggle
                                                    visible={visibility[type]}
                                                    label={type === 'room' ? 'rooms' : type === 'icon' ? 'fixtures' : 'junctions'}
                                                    onToggle={() => model.visibilityChanged({ type, visible: !visibility[type] })}
                                                />
                                            </div>
                                            <details open>
                                                <summary className="cursor-pointer pl-4 pr-12 py-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
                                                    <span className="ml-1">{type === 'room' ? 'Rooms' : type === 'icon' ? 'Fixtures' : 'Junctions'}</span>{' '}
                                                    <span className="ml-2 text-muted-foreground">{items.length}</span>
                                                </summary>
                                                {[...new Set(items.map((item) => item.property.label))]
                                                    .sort((a, b) => a.localeCompare(b))
                                                    .map((category) => {
                                                        const members = items.filter((item) => item.property.label === category);
                                                        const visible =
                                                            visibility[type] && members.some((item) => !hiddenObjects.includes(`${item.page}:${item.index}`));
                                                        return (
                                                            <div key={category} className="relative">
                                                                <div className="absolute right-2 top-1 z-10">
                                                                    <VisibilityToggle
                                                                        visible={visible}
                                                                        label={`${category} category`}
                                                                        onToggle={() => {
                                                                            if (!visible && !visibility[type]) model.visibilityChanged({ type, visible: true });
                                                                            for (const { page, index } of members)
                                                                                model.objectVisibilityChanged({ object: { page, index }, visible: !visible });
                                                                        }}
                                                                    />
                                                                </div>
                                                                <details>
                                                                    <summary className="cursor-pointer py-3 pl-6 pr-12 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
                                                                        <span
                                                                            className="ml-1 mr-2 inline-block size-2 rounded-full"
                                                                            style={{ backgroundColor: getDetectedObjectColor({ type, label: category }) }}
                                                                            aria-hidden
                                                                        />
                                                                        {category}
                                                                        <span className="ml-2 text-muted-foreground">{members.length}</span>
                                                                    </summary>
                                                                    <ul className="pb-2">
                                                                        {members.map(({ property, page, index }, groupIndex) => {
                                                                            const selected = selection.some(
                                                                                (item) => item.page === page && item.index === index,
                                                                            );
                                                                            return (
                                                                                <li key={`${page}:${index}`} className="flex items-center pr-2">
                                                                                    <button
                                                                                        type="button"
                                                                                        disabled={attachment?.hiddenFromCanvas}
                                                                                        aria-pressed={selected}
                                                                                        data-layer-page={page}
                                                                                        data-layer-index={index}
                                                                                        onKeyDown={(event) => {
                                                                                            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
                                                                                                return;
                                                                                            event.preventDefault();
                                                                                            const visibleRows = rows();
                                                                                            const current = visibleRows.indexOf(event.currentTarget);
                                                                                            const next =
                                                                                                event.key === 'Home'
                                                                                                    ? 0
                                                                                                    : event.key === 'End'
                                                                                                      ? visibleRows.length - 1
                                                                                                      : Math.max(
                                                                                                            0,
                                                                                                            Math.min(
                                                                                                                visibleRows.length - 1,
                                                                                                                current + (event.key === 'ArrowDown' ? 1 : -1),
                                                                                                            ),
                                                                                                        );
                                                                                            const row = visibleRows[next];
                                                                                            if (!row) return;
                                                                                            row.focus({ preventScroll: true });
                                                                                            row.scrollIntoView({ block: 'nearest' });
                                                                                            selectRow(row, event.shiftKey);
                                                                                        }}
                                                                                        className="flex min-w-0 flex-1 items-center gap-2 pl-10 pr-1 py-2 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-50 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                                                                                        onClick={(event) => {
                                                                                            if (!visibility[type])
                                                                                                model.visibilityChanged({ type, visible: true });
                                                                                            const object = { page, index };
                                                                                            model.objectVisibilityChanged({ object, visible: true });
                                                                                            selectRow(event.currentTarget, event.shiftKey);
                                                                                        }}
                                                                                    >
                                                                                        <span
                                                                                            className="size-2 shrink-0 rounded-full"
                                                                                            style={{ backgroundColor: getDetectedObjectColor(property) }}
                                                                                            aria-hidden
                                                                                        />
                                                                                        <span className="min-w-0 flex-1 truncate">
                                                                                            {property.label}{' '}
                                                                                            <span className="text-muted-foreground">
                                                                                                {groupIndex + 1} · Sheet {page}
                                                                                            </span>
                                                                                        </span>
                                                                                    </button>
                                                                                    <VisibilityToggle
                                                                                        visible={
                                                                                            visibility[type] && !hiddenObjects.includes(`${page}:${index}`)
                                                                                        }
                                                                                        label={`${property.label} ${groupIndex + 1}, sheet ${page}`}
                                                                                        onToggle={() => {
                                                                                            const visible =
                                                                                                !visibility[type] || hiddenObjects.includes(`${page}:${index}`);
                                                                                            if (visible && !visibility[type])
                                                                                                model.visibilityChanged({ type, visible: true });
                                                                                            model.objectVisibilityChanged({ object: { page, index }, visible });
                                                                                        }}
                                                                                    />
                                                                                </li>
                                                                            );
                                                                        })}
                                                                    </ul>
                                                                </details>
                                                            </div>
                                                        );
                                                    })}
                                            </details>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
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
