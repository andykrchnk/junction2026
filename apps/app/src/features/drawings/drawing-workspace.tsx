import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUnit } from 'effector-react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';
import { z } from 'zod';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { $$user } from '@/entities/user/model';
import { trpc } from '@/shared/trpc';
import { DrawingChat } from './drawing-chat';
import { readLocal, writeLocal } from './canvas-storage';

const BlueprintCanvas = lazy(() => import('./blueprint-canvas'));
const LayoutZod = z
    .object({ canvas: z.number().min(40).max(80), chat: z.number().min(20).max(60) })
    .refine((layout) => Math.abs(layout.canvas + layout.chat - 100) < 1);

function WorkspacePanels({ id, userId }: Readonly<{ id: string; userId: string }>) {
    const { data: drawing, isPending, error } = useQuery(trpc.drawings.get.queryOptions({ id }));
    const layoutKey = `junction:workspace:${userId}:${id}:layout`;
    const [layout] = useState(() => {
        const parsed = LayoutZod.safeParse(readLocal(layoutKey));
        return parsed.success ? parsed.data : { canvas: 70, chat: 30 };
    });
    const [mobilePane, setMobilePane] = useState<'canvas' | 'chat'>('canvas');
    const [isNarrow, setIsNarrow] = useState(false);
    const groupRef = useGroupRef();
    useEffect(() => {
        const media = window.matchMedia('(width < 48rem)');
        const update = () => {
            setIsNarrow(media.matches);
            if (!media.matches) {
                const saved = LayoutZod.safeParse(readLocal(layoutKey));
                groupRef.current?.setLayout(saved.success ? saved.data : layout);
            }
        };
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, [layoutKey, layout, groupRef]);
    if (isPending)
        return (
            <p role="status" className="p-6 text-sm">
                Opening drawing…
            </p>
        );
    if (!drawing)
        return (
            <p role="alert" className="p-6 text-sm text-destructive">
                {error?.message ?? 'Drawing not found.'}
            </p>
        );
    const canvas = drawing.attachment ? (
        <Suspense
            fallback={
                <p role="status" className="m-auto p-6 text-sm">
                    Loading canvas…
                </p>
            }
        >
            <BlueprintCanvas drawing={drawing} userId={userId} />
        </Suspense>
    ) : (
        <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
                <p className="text-lg font-medium">Your blueprint starts here</p>
                <p className="mt-2 text-sm text-muted-foreground">Upload a drawing in the chat panel to open it on the canvas.</p>
                <Button className="mt-4 md:hidden" onClick={() => setMobilePane('chat')}>
                    Upload blueprint
                </Button>
            </div>
        </div>
    );
    return (
        <section className="flex h-svh min-h-0 flex-1 flex-col overflow-hidden">
            <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-5">
                <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Drawing workspace</p>
                    <h1 className="truncate text-sm font-medium">{drawing.title}</h1>
                </div>
                <div className="flex gap-1 md:hidden">
                    <Link to="/" search={{}} className="self-center px-2 text-xs text-muted-foreground underline">
                        Sessions
                    </Link>
                    <Button size="sm" variant="ghost" aria-pressed={mobilePane === 'canvas'} onClick={() => setMobilePane('canvas')}>
                        Canvas
                    </Button>
                    <Button size="sm" variant="ghost" aria-pressed={mobilePane === 'chat'} onClick={() => setMobilePane('chat')}>
                        Chat
                    </Button>
                </div>
            </header>
            {/* react-resizable-panels supplies keyboard and pointer resizing; Fluid has no split-pane primitive. */}
            <Group
                groupRef={groupRef}
                disabled={isNarrow}
                className={`min-h-0 flex-1 ${mobilePane === 'canvas' ? 'workspace-show-canvas' : 'workspace-show-chat'}`}
                defaultLayout={layout}
                onLayoutChanged={(next, meta) => {
                    if (meta.isUserInteraction) writeLocal(layoutKey, next);
                }}
            >
                <Panel id="canvas" defaultSize="70%" minSize="40%" maxSize="80%" className="workspace-canvas min-w-0 bg-muted/30">
                    {canvas}
                </Panel>
                <Separator
                    aria-label="Resize canvas and chat"
                    className="workspace-divider w-1 shrink-0 bg-border transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-none"
                />
                <Panel id="chat" defaultSize="30%" minSize="20%" maxSize="60%" className="workspace-chat min-w-0 bg-background">
                    <DrawingChat id={id} />
                </Panel>
            </Group>
        </section>
    );
}

export function DrawingWorkspace({ id }: Readonly<{ id: string }>) {
    const user = useUnit($$user.$user);
    if (!user) return null;
    return <WorkspacePanels key={`${user.id}:${id}`} id={id} userId={user.id} />;
}
