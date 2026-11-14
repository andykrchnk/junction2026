import { useState } from 'react';
import type { Drawing } from '@repo/types';
import { Button } from '@repo/design-system/components/ui/button';
import { Input } from '@repo/design-system/components/ui/input';
import { ChevronDown } from '@repo/design-system/lib/icons-remix';
import { DrawingChat } from './drawing-chat';
import { $$drawings } from './model';

export function SessionChatPanel({ drawing, previewDrawing }: Readonly<{ drawing: Drawing; previewDrawing?: Drawing }>) {
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
        <aside
            aria-label="Session sidebar"
            className={`${collapsed ? 'absolute left-0 top-0 z-20' : 'relative shrink-0'} max-w-[calc(100vw-16px)] p-2`}
            style={{ width }}
        >
            <div className={`bg-card border border-border flex min-h-0 flex-col ${collapsed ? '' : 'h-full'}`}>
                <header className="flex min-h-20 shrink-0 items-center gap-2 px-3 py-3">
                    <div className="min-w-0 flex-1">
                        {editing ? (
                            <form
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    void save();
                                }}
                            >
                                <Input
                                    autoFocus
                                    aria-label="Session name"
                                    value={draft}
                                    maxLength={200}
                                    disabled={saving}
                                    onChange={(event) => setDraft(event.target.value)}
                                    onBlur={() => {
                                        void save();
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                            event.preventDefault();
                                            setDraft(title);
                                            setEditing(false);
                                            setError('');
                                        }
                                    }}
                                />
                            </form>
                        ) : (
                            <button
                                className="w-full truncate border border-transparent px-1 py-1 text-left text-sm font-medium hover:border-border focus-visible:border-foreground focus-visible:outline-none"
                                title="Double-click to rename"
                                onDoubleClick={() => {
                                    setDraft(title);
                                    setEditing(true);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === 'F2') {
                                        event.preventDefault();
                                        setDraft(title);
                                        setEditing(true);
                                    }
                                }}
                            >
                                {title}
                            </button>
                        )}
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
                        {collapsed ? <ChevronDown size={16} /> : <ChevronDown size={16} className="rotate-180" />}
                    </Button>
                </header>
                {!collapsed && (
                    <div className="min-h-0 flex-1 border-t">
                        <DrawingChat id={drawing.id} previewDrawing={previewDrawing} />
                    </div>
                )}
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
        </aside>
    );
}
