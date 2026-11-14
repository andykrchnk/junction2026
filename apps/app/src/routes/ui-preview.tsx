import { z } from 'zod';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { SessionWorkshop } from '../../../../design-system/src/prototypes/session-workshop';

export const Route = createFileRoute('/ui-preview')({
    ssr: false,
    validateSearch: z.object({ tables: z.literal(1).optional() }),
    beforeLoad: () => {
        if (!import.meta.env.DEV || sessionStorage.getItem('pirto-design-preview') !== 'active') throw redirect({ to: '/login' });
    },
    component: DashboardPreview,
});

// Local UI simulation only; never grants a platform session or server access.
function DashboardPreview() {
    const navigate = useNavigate();
    const { tables } = Route.useSearch();
    return (
        <SessionWorkshop
            key={tables ?? 'official'}
            official
            tableExperiment={tables === 1}
            onSignOut={() => {
                sessionStorage.removeItem('pirto-design-preview');
                void navigate({ to: '/login' });
            }}
        />
    );
}
