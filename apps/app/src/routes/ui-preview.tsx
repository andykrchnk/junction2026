import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { SessionWorkshop } from '../../../../design-system/src/prototypes/session-workshop';

export const Route = createFileRoute('/ui-preview')({
    ssr: false,
    beforeLoad: () => {
        if (!import.meta.env.DEV || sessionStorage.getItem('pirto-design-preview') !== 'active') throw redirect({ to: '/login' });
    },
    component: DashboardPreview,
});

// Local UI simulation only; never grants a platform session or server access.
function DashboardPreview() {
    const navigate = useNavigate();
    return (
        <SessionWorkshop
            official
            onSignOut={() => {
                sessionStorage.removeItem('pirto-design-preview');
                void navigate({ to: '/login' });
            }}
        />
    );
}
