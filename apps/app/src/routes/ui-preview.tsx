import { z } from 'zod';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { SessionWorkshop } from '@/prototypes/session-workshop';

export const Route = createFileRoute('/ui-preview')({
    ssr: false,
    validateSearch: z.object({ tables: z.literal(1).optional(), view: z.enum(['cards', 'table']).optional() }),
    beforeLoad: () => {
        if (!import.meta.env.DEV) throw redirect({ to: '/login' });
    },
    component: DashboardPreview,
});

// Local UI simulation only; never grants a platform session or server access.
function DashboardPreview() {
    const navigate = useNavigate();
    const { tables, view } = Route.useSearch();
    return (
        <SessionWorkshop
            key={`${tables ?? 'official'}-${view ?? 'cards'}`}
            official
            initialTable={view === 'table'}
            tableExperiment={tables === 1}
            onSignOut={() => {
                void navigate({ to: '/login' });
            }}
        />
    );
}
