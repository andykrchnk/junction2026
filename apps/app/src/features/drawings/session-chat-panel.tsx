import { useState, useRef, useEffect } from 'react';
import type { Drawing } from '@repo/types';
import { Button } from '@repo/design-system/components/ui/button';
import { motion, useReducedMotion } from 'motion/react';
import { spring } from '@repo/design-system/lib/springs';
import { remixIcons } from '@repo/design-system/lib/icons-remix';
const CollapseIcon = remixIcons['panel-left'];
import { DrawingChat } from './drawing-chat';
import { $$drawings } from './model';

export function SessionChatPanel({ drawing, previewDrawing }: Readonly<{ drawing: Drawing; previewDrawing?: Drawing }>) {
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
    const [title, setTitle] = useState(drawing.title);
    const [draft, setDraft] = useState(drawing.title);
    const [savedAt, setSavedAt] = useState(drawing.updatedAt);
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
            setTitle(result.title);
            setSavedAt(result.updatedAt);
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
                <div className="bg-card border border-border flex h-full min-h-0 flex-col overflow-hidden">
                    <header className="flex min-h-20 shrink-0 items-center gap-2 px-3 py-3">
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
                                    className="block h-8 w-full min-w-0 truncate rounded-none border border-transparent bg-transparent px-1 py-1 text-left text-sm font-medium leading-5 hover:border-border focus:border-border focus:outline-none"
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
                            <p role="status" className="mt-1 px-1 text-xs text-muted-foreground">
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
                        <DrawingChat id={drawing.id} previewDrawing={previewDrawing} />
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
