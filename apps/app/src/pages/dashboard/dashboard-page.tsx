import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useUnit } from 'effector-react';
import { FileStack, Layers3, LogOut, ArrowUpRight, FolderOpen, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { $$user } from '@/entities/user/model';
import { trpc } from '@/shared/trpc';

export function DashboardPage() {
    const { user, error, isPending } = useUnit({ user: $$user.$user, error: $$user.$error, isPending: $$user.$isPending });
    const { data, isPending: isConnecting } = useQuery(trpc.system.status.queryOptions());
    const navigate = useNavigate();
    const handleSignOut = async () => {
        try {
            await $$user.signOutFx();
            await navigate({ to: '/login', replace: true });
        } catch {
            // The auth model keeps the current session and exposes the sign-out error.
        }
    };
    return (
        <div className="flex min-h-svh flex-col md:flex-row">
            <aside className="bg-card flex border-b p-5 md:w-64 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:p-7">
                <div className="flex items-center gap-3 text-xl font-semibold tracking-tight">
                    <Layers3 className="text-primary size-6" />
                    junction.
                </div>
                <div className="mt-14 hidden md:block">
                    <p className="text-muted-foreground mb-4 text-[10px] font-semibold tracking-[0.18em] uppercase">Workspace</p>
                    <div aria-current="page" className="bg-secondary text-primary flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium">
                        <FolderOpen className="size-4" />
                        Drawing library
                    </div>
                </div>
                <div className="mt-auto hidden pt-12 md:block">
                    <Separator />
                    <div className="mt-6 flex items-center gap-3">
                        <Avatar>
                            <AvatarFallback>{user?.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{user?.name}</p>
                            <p className="text-muted-foreground truncate text-xs">{user?.email}</p>
                        </div>
                    </div>
                </div>
                <Button
                    className="ml-auto md:mt-5 md:ml-0 md:justify-start"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        void handleSignOut();
                    }}
                    disabled={isPending}
                >
                    <LogOut className="size-4" />
                    {isPending ? 'Signing out…' : 'Sign out'}
                </Button>
            </aside>
            <main className="min-w-0 flex-1 px-6 py-7 md:px-12">
                <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-7">
                    <span className="text-muted-foreground text-sm">
                        Workspace / <span className="text-foreground">Drawing library</span>
                    </span>
                    <span role="status" className="text-muted-foreground flex items-center gap-2 text-xs">
                        <span className={`size-1.5 rounded-full ${data ? 'bg-primary' : 'bg-amber-600'}`} />
                        {data ? 'API connected' : isConnecting ? 'Connecting to API…' : 'API unavailable'}
                    </span>
                </header>
                {error && (
                    <p role="alert" className="text-destructive mt-4 text-sm">
                        {error}
                    </p>
                )}
                <section className="mx-auto max-w-5xl py-12 md:py-16">
                    <p className="text-primary text-xs font-semibold tracking-[0.16em] uppercase">Your project, in focus</p>
                    <h1 className="mt-4 text-3xl font-medium tracking-tight md:text-4xl">A clearer view of every drawing.</h1>
                    <p className="text-muted-foreground mt-4 max-w-xl text-sm leading-relaxed">
                        Your space for construction drawings and answers grounded in evidence.
                    </p>
                    <div className="mt-12 flex items-center justify-between border-b pb-4">
                        <h2 className="text-sm font-semibold">Drawing library</h2>
                        <span className="text-muted-foreground text-xs">0 documents</span>
                    </div>
                    <div className="bg-card mt-5 flex min-h-80 flex-col items-center justify-center border border-dashed p-8 text-center">
                        <FileStack className="text-primary mb-5 size-9 stroke-1" />
                        <h3 className="text-lg font-medium">A clean slate for your next project.</h3>
                        <p className="text-muted-foreground mt-3 max-w-sm text-sm leading-relaxed">
                            No drawings have been added. Your project documents will appear here once document ingestion is available.
                        </p>
                    </div>
                    <footer className="text-muted-foreground mt-7 flex flex-wrap justify-between gap-3 text-xs">
                        <span className="flex items-center gap-2">
                            <ShieldCheck className="size-4" />
                            Signed in as {user?.email}
                        </span>
                        <span className="flex items-center gap-1">
                            From drawings to decisions
                            <ArrowUpRight className="size-3" />
                        </span>
                    </footer>
                </section>
            </main>
        </div>
    );
}
