import { AppHeader } from '@/components/app-header';
import { SessionLayouts } from '@/components/session-dashboard/session-layouts';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useUnit } from 'effector-react';
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
                    createdAt: drawing.createdAt,
                    documentCount: drawing.documentCount,
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
        <div className="flex h-svh flex-col overflow-hidden">
            <AppHeader
                accountName={user?.email ?? 'Account'}
                onSignOut={() => {
                    if (!signingOut) void signOut();
                }}
            />
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                <main className="flex min-w-0 flex-1 flex-col">
                    {(authError || error?.id === null) && (
                        <p role="alert" className="m-5 text-sm text-destructive">
                            {authError ?? error?.message}
                        </p>
                    )}
                    <DrawingWorkspace key={id} id={id} />
                </main>
            </div>
        </div>
    );
}
