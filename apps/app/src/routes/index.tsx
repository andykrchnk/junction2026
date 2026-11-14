import { z } from 'zod';
import { MongoIdZod } from '@repo/types';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { DashboardPage } from '@/pages/dashboard/dashboard-page';
import { $$user } from '@/entities/user/model';

export const Route = createFileRoute('/')({
    ssr: false,
    validateSearch: z.object({ drawing: MongoIdZod.optional() }),
    beforeLoad: async () => {
        const { user } = await $$user.getUserFx();
        if (!user) throw redirect({ to: '/login' });
    },
    errorComponent: ({ reset }) => (
        <main className="mx-auto max-w-lg p-12">
            <h1 className="text-2xl font-medium">We could not open your workspace.</h1>
            <p className="text-muted-foreground my-4">Check your connection and try again.</p>
            <button className="underline" onClick={reset}>
                Try again
            </button>
        </main>
    ),
    component: DashboardPage,
});
