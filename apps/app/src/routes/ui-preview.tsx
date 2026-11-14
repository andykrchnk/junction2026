import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { SessionWorkshop } from '../../../../design-system/src/prototypes/session-workshop';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const Route = createFileRoute('/ui-preview')({
    ssr: false,
    beforeLoad: () => {
        if (!import.meta.env.DEV) throw redirect({ to: '/login' });
    },
    component: PreviewLogin,
});

// This gate only simulates a login into isolated, in-memory UI prototypes.
// It grants no platform session, server access, or real data access.
function PreviewLogin() {
    const [entered, setEntered] = useState(false);
    const [email, setEmail] = useState('demo@pirto.local');
    const [password, setPassword] = useState('Preview2026!');
    const [error, setError] = useState('');
    if (entered) return <SessionWorkshop />;
    return (
        <main className="pw-demo-login">
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    if (email === 'demo@pirto.local' && password === 'Preview2026!') setEntered(true);
                    else setError('Use demo@pirto.local and Preview2026! for this prototype.');
                }}
            >
                <BrandLogo />
                <div>
                    <h1>Explore your workspace.</h1>
                    <p>Five dashboard directions. A local prototype with example analysis and no connection to your account.</p>
                </div>
                <label>
                    Email
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label>
                    Password
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </label>
                {error && <p role="alert">{error}</p>}
                <Button type="submit">Enter design preview</Button>
                <p>Sample login is prefilled. These credentials work only in this development preview.</p>
            </form>
        </main>
    );
}
