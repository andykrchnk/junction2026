import type { CommentsModel } from './canvas/comments-model';
import { useState, useRef, useEffect } from 'react';
import type { Drawing } from '@repo/types';
import { Button } from '@repo/design-system/components/ui/button';
import { motion, useReducedMotion } from 'motion/react';
import { spring } from '@repo/design-system/lib/springs';
import { useUnit } from 'effector-react';
import { Toolbar } from '@repo/design-system/components/ui/toolbar';
import { Tooltip } from '@repo/design-system/components/ui/tooltip';
import { MessageAdd, remixIcons } from '@repo/design-system/lib/icons-remix';
const CollapseIcon = remixIcons['panel-left'];
import { DrawingChat } from './drawing-chat';
import { $$drawings } from './model';

function CommentTool({ drawing, model }: Readonly<{ drawing: Drawing; model: CommentsModel }>) {
    const { mode, modeChanged } = useUnit({ mode: model.$mode, modeChanged: model.modeChanged });
    const active = mode === 'comment';
    const [hovered, setHovered] = useState(false);
    const expanded = active || hovered;
    const reducedMotion = useReducedMotion();
    return (
        <Toolbar.Root
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            aria-label="Canvas tools"
            className="absolute left-full top-[27px] ml-2 flex border border-border bg-card p-1 shadow-sm max-md:left-auto max-md:right-16 max-md:ml-0"
        >
            <Tooltip content={active ? 'Exit commenting' : 'Place a comment on the blueprint'} shortcut="C">
                <Toolbar.Button
                    render={<Button className="px-2.5" variant={active ? 'primary' : 'secondary'} />}
                    data-active={active}
                    /* Keep the Fluid button styling inside the toolbar primitive. */
                    aria-label="Comment"
                    aria-pressed={active}
                    disabled={!drawing.blueprints.some((blueprint) => !blueprint.attachment.hiddenFromCanvas)}
                    onClick={() => {
                        if (active) setHovered(false);
                        modeChanged(active ? 'default' : 'comment');
                    }}
                >
                    <span className="flex items-center">
                        <MessageAdd size={16} className="shrink-0" aria-hidden />
                        <motion.span
                            initial={false}
                            animate={{ width: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
                            transition={reducedMotion ? { duration: 0 } : spring.fast}
                            className="block overflow-hidden"
                            aria-hidden="true"
                        >
                            <span className="block pl-2">Comment</span>
                        </motion.span>
                    </span>
                </Toolbar.Button>
            </Tooltip>
        </Toolbar.Root>
    );
}

export function SessionChatPanel({
    drawing,
    previewDrawing,
    commentsModel,
}: Readonly<{ drawing: Drawing; previewDrawing?: Drawing; commentsModel?: CommentsModel }>) {
    const container = useRef<HTMLDivElement>(null);
    const reducedMotion = useReducedMotion();
    const [height, setHeight] = useState(600);
    useEffect(() => {
        const parent = container.current?.parentElement;
        if (!parent) return;
        const observer = new ResizeObserver(() => setHeight(parent.clientHeight));
        setHeight(parent.clientHeight);
        observer.observe(parent);
        return () => observer.disconnect();
    }, []);
    const [collapsed, setCollapsed] = useState(false);
    const [width, setWidth] = useState(360);
    const [editing, setEditing] = useState(false);
    const [localSaved, setLocalSaved] = useState<Pick<Drawing, 'title' | 'updatedAt'> | null>(null);
    const saved = previewDrawing && localSaved ? localSaved : drawing;
    const title = saved.title;
    const savedAt = saved.updatedAt;
    const [draft, setDraft] = useState(drawing.title);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    async function save() {
        if (saving) return;
        const next = draft.trim();
        if (!next) {
            setError('Enter a session name.');
            return;
        }
        if (next === title) {
            setEditing(false);
            return;
        }
        setSaving(true);
        setError('');
        try {
            const result = previewDrawing ? { title: next, updatedAt: new Date().toISOString() } : await $$drawings.renameFx({ id: drawing.id, title: next });
            if (previewDrawing) setLocalSaved({ title: result.title, updatedAt: result.updatedAt });
            setEditing(false);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not save. Please retry.');
        } finally {
            setSaving(false);
        }
    }
    return (
        <motion.div
            ref={container}
            className="relative shrink-0"
            animate={{ width: collapsed ? 0 : width }}
            transition={reducedMotion ? { duration: 0 } : spring.slow}
        >
            <motion.aside
                aria-label="Session sidebar"
                className="absolute left-0 top-0 z-20 max-w-[calc(100vw-16px)] p-2"
                style={{ width }}
                initial={false}
                animate={{ height: collapsed ? 98 : height }}
                transition={reducedMotion ? { duration: 0 } : spring.slow}
            >
                {commentsModel && !previewDrawing && <CommentTool drawing={drawing} model={commentsModel} />}
                <div className="bg-card border border-border flex h-full min-h-0 flex-col overflow-hidden">
                    <header
                        className={`flex min-h-20 shrink-0 items-center gap-2 px-3 py-[2px] ${commentsModel && !previewDrawing ? 'max-md:pr-[188px]' : 'max-md:pr-14'}`}
                    >
                        <div className="min-w-0 flex-1">
                            <form
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    if (editing) void save();
                                }}
                            >
                                <input
                                    aria-label="Session name"
                                    readOnly={!editing}
                                    value={editing ? draft : title}
                                    maxLength={200}
                                    disabled={saving}
                                    className="block h-8 w-full min-w-0 truncate rounded-none border border-transparent bg-transparent px-1 py-[2px] text-left text-sm font-medium leading-5 hover:border-border focus:border-border focus:outline-none"
                                    onDoubleClick={() => {
                                        setDraft(title);
                                        setEditing(true);
                                    }}
                                    onChange={(event) => setDraft(event.target.value)}
                                    onBlur={() => {
                                        if (editing) void save();
                                    }}
                                    onKeyDown={(event) => {
                                        if (!editing && (event.key === 'Enter' || event.key === 'F2')) {
                                            event.preventDefault();
                                            setDraft(title);
                                            setEditing(true);
                                        } else if (event.key === 'Escape') {
                                            event.preventDefault();
                                            setDraft(title);
                                            setEditing(false);
                                            setError('');
                                        }
                                    }}
                                />
                            </form>
                            <p role="status" className="mt-1 px-1 pb-2 text-xs text-muted-foreground">
                                {saving
                                    ? 'Saving…'
                                    : error
                                      ? 'Not saved'
                                      : `${previewDrawing ? 'Updated locally' : 'Saved'} ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                            </p>
                            {error && (
                                <p role="alert" className="px-1 text-xs text-destructive">
                                    {error}
                                </p>
                            )}
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="max-md:absolute max-md:right-5 max-md:top-[31px]"
                            aria-label={collapsed ? 'Expand chat' : 'Collapse chat'}
                            aria-expanded={!collapsed}
                            onClick={() => setCollapsed(!collapsed)}
                        >
                            <CollapseIcon size={16} aria-hidden />
                        </Button>
                    </header>
                    <div
                        inert={collapsed}
                        aria-hidden={collapsed}
                        className="min-h-0 flex-1 overflow-hidden border-t"
                        style={{ visibility: collapsed ? 'hidden' : 'visible' }}
                    >
                        <DrawingChat commentsModel={commentsModel} id={drawing.id} previewDrawing={previewDrawing} />
                    </div>
                </div>
                <div
                    role="separator"
                    tabIndex={0}
                    aria-label="Resize session sidebar"
                    aria-orientation="vertical"
                    aria-valuemin={280}
                    aria-valuemax={600}
                    aria-valuenow={width}
                    className="absolute right-0 top-2 bottom-2 w-2 cursor-col-resize touch-none hover:bg-border focus-visible:bg-border focus-visible:outline-none"
                    onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId))
                            setWidth(Math.max(280, Math.min(600, event.clientX - (event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0))));
                    }}
                    onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                            event.preventDefault();
                            setWidth((current) => Math.max(280, Math.min(600, current + (event.key === 'ArrowLeft' ? -16 : 16))));
                        }
                    }}
                />
            </motion.aside>
        </motion.div>
    );
}
