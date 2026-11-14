import { SessionLayouts } from '../../../../../design-system/src/components/session-dashboard/session-layouts';
import { BrandLogo } from '@/components/ui/brand-logo';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link, useSearch } from '@tanstack/react-router';
import { useUnit } from 'effector-react';
import { LogOut, Plus, FileStack } from '@/lib/icons-remix';
import { Button } from '@/components/ui/button';
import { $$user } from '@/entities/user/model';
import { $$drawings } from '@/features/drawings/model';
import { DrawingWorkspace } from '@/features/drawings/drawing-workspace';
import { trpc } from '@/shared/trpc';

export function DashboardPage() {
    const { drawing: id } = useSearch({ from: '/' });
    const navigate = useNavigate();
    const { authError, signingOut, creating, error, user } = useUnit({
        authError: $$user.$error,
        user: $$user.$user,
        signingOut: $$user.$isPending,
        creating: $$drawings.$creating,
        error: $$drawings.$error,
    });
    const { data: drawings, isPending, error: listError } = useQuery(trpc.drawings.list.queryOptions());
    useEffect(() => {
        $$drawings.opened(id ?? null);
    }, [id]);
    const create = async () => {
        try {
            const drawing = await $$drawings.createFx();
            await navigate({ to: '/', search: { drawing: drawing.id } });
        } catch {
            /* The feature model owns the error. */
        }
    };
    const signOut = async () => {
        try {
            await $$user.signOutFx();
            $$drawings.opened(null);
            await navigate({ to: '/login', replace: true });
        } catch {
            /* The auth model owns the error. */
        }
    };
    if (!id)
        return (
            <SessionLayouts
                variant={0}
                accountName={user?.email ?? 'Account'}
                onSignOut={() => {
                    if (!signingOut) void signOut();
                }}
                pending={creating}
                loading={isPending}
                sample={false}
                error={authError ?? (error?.id === null ? error.message : undefined) ?? listError?.message}
                sessions={(drawings ?? []).map((drawing, index, all) => ({
                    id: all.length - index,
                    name: drawing.title,
                    file: `Updated ${new Date(drawing.updatedAt).toLocaleDateString()}`,
                    status: { empty: 'New', uploaded: 'Uploaded', analyzing: 'Analyzing', ready: 'Ready', failed: 'Needs attention' }[drawing.status],
                }))}
                onNew={() => {
                    void create();
                }}
                onOpen={(session) => {
                    const drawing = drawings?.[(drawings?.length ?? 0) - session.id];
                    if (drawing) void navigate({ to: '/', search: { drawing: drawing.id } });
                }}
            />
        );
    return (
        <div className="flex min-h-svh flex-col md:flex-row">
            <aside className="bg-card flex flex-col border-b p-5 md:sticky md:top-0 md:h-svh md:w-64 md:shrink-0 md:border-r md:border-b-0">
                <Link to="/" search={{}} className="mb-6 flex items-center gap-3 text-xl font-semibold tracking-tight">
                    <BrandLogo />
                </Link>
                <Button
                    leadingIcon={Plus}
                    loading={creating}
                    onClick={() => {
                        void create();
                    }}
                >
                    New session
                </Button>
                <nav aria-label="Drawing sessions" className="mt-5 flex max-h-44 flex-col gap-1 overflow-y-auto md:max-h-none md:flex-1">
                    {isPending && (
                        <p className="text-muted-foreground p-2 text-xs" role="status">
                            Loading sessions…
                        </p>
                    )}
                    {listError && (
                        <p className="p-2 text-xs text-destructive" role="alert">
                            {listError.message}
                        </p>
                    )}
                    {drawings?.map((drawing) => (
                        <Button key={drawing.id} asChild variant="ghost" active={drawing.id === id} className="h-auto justify-start py-2">
                            <Link to="/" search={{ drawing: drawing.id }} aria-current={drawing.id === id ? 'page' : undefined}>
                                <span className="block min-w-0 text-left">
                                    <span className="block max-w-44 truncate text-sm">{drawing.title}</span>
                                    <span className="text-muted-foreground block text-xs font-normal">
                                        {drawing.status} · {new Date(drawing.updatedAt).toLocaleDateString()}
                                    </span>
                                </span>
                            </Link>
                        </Button>
                    ))}
                    {drawings?.length === 0 && <p className="text-muted-foreground p-2 text-xs">Your drawings will appear here.</p>}
                </nav>
                <div className="mt-5 border-t pt-4">
                    <Button
                        variant="ghost"
                        size="compact"
                        leadingIcon={LogOut}
                        loading={signingOut}
                        onClick={() => {
                            void signOut();
                        }}
                    >
                        Sign out
                    </Button>
                </div>
            </aside>
            <main className="flex min-w-0 flex-1 flex-col">
                {(authError || error?.id === null) && (
                    <p role="alert" className="m-5 text-sm text-destructive">
                        {authError ?? error?.message}
                    </p>
                )}
                {id ? (
                    <DrawingWorkspace key={id} id={id} />
                ) : (
                    <section className="m-auto max-w-xl px-6 py-20 text-center">
                        <FileStack className="text-primary mx-auto mb-6 size-10 stroke-1" aria-hidden />
                        <h1 className="mt-4 text-3xl font-medium tracking-tight">A clearer view of your blueprint.</h1>
                        <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                            Upload a drawing, review its analysis, and ask questions with source evidence. Your sessions stay here when you return.
                        </p>
                        <Button
                            className="mt-7"
                            leadingIcon={Plus}
                            loading={creating}
                            onClick={() => {
                                void create();
                            }}
                        >
                            Start a drawing session
                        </Button>
                    </section>
                )}
            </main>
        </div>
    );
}
