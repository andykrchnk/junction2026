import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/shared/trpc';
import { FileStack, Layers3, ArrowUpRight, ScanLine } from 'lucide-react';

export function DashboardPage() {
    const { data, isPending } = useQuery(trpc.system.status.queryOptions());
    return (
        <main className="min-h-svh p-6 md:p-12">
            <header className="flex items-center gap-3 border-b pb-6">
                <Layers3 className="size-6" />
                <span className="text-xl font-semibold tracking-tight">
                    junction<span className="text-primary">.</span>
                </span>
                <span className="text-muted-foreground ml-auto text-sm">{data ? 'API connected' : isPending ? 'Connecting to API…' : 'API unavailable'}</span>
            </header>
            <section className="mx-auto max-w-5xl py-20">
                <p className="text-primary text-xs font-semibold tracking-[0.18em] uppercase">From drawings to decisions</p>
                <h1 className="mt-4 max-w-2xl text-4xl leading-tight font-medium tracking-tight md:text-6xl">
                    Every answer starts
                    <br />
                    with the evidence.
                </h1>
                <p className="text-muted-foreground mt-6 max-w-xl text-lg">
                    A shared workspace for construction drawings, measurable quantities, and answers you can trace back to the source.
                </p>
                <div className="bg-card mt-12 flex flex-col gap-6 border p-8 md:flex-row md:items-center">
                    <FileStack className="text-primary size-9" />
                    <div>
                        <h2 className="text-lg font-semibold">Your drawing library</h2>
                        <p className="text-muted-foreground mt-1 text-sm">No drawings yet. Document ingestion will be connected here.</p>
                    </div>
                    <ScanLine className="text-muted-foreground ml-auto size-6" />
                </div>
                <div className="text-muted-foreground mt-8 flex items-center gap-2 text-sm">
                    <ArrowUpRight className="size-4" />
                    Built for answers you can verify.
                </div>
            </section>
        </main>
    );
}
