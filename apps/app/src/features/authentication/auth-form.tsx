import { AuthHero } from './auth-hero';
import { BrandLogo } from '@/components/ui/brand-logo';
import { useForm } from '@tanstack/react-form';
import { Link, useNavigate } from '@tanstack/react-router';
import { useUnit } from 'effector-react';
import { useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { SignInInputZod, SignUpInputZod } from '@repo/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { $$user } from '@/entities/user/model';

type AuthFormProps = { mode: 'sign-in' | 'register' };
export function AuthForm(props: Readonly<AuthFormProps>) {
    const { mode } = props;
    const { error, isPending } = useUnit({ error: $$user.$error, isPending: $$user.$isPending });
    const navigate = useNavigate();
    useEffect(() => {
        $$user.formOpened();
    }, [mode]);
    const form = useForm({
        defaultValues: { email: '', password: '' },
        validators: {
            onSubmit: ({ value }) => {
                const result = (mode === 'register' ? SignUpInputZod : SignInInputZod).safeParse(value);
                return result.success ? undefined : result.error.issues[0]?.message;
            },
        },
        onSubmit: async ({ value }) => {
            if (import.meta.env.DEV && mode === 'sign-in' && value.email === 'demo@pirto.local' && value.password === 'Preview2026!') {
                sessionStorage.setItem('pirto-design-preview', 'active');
                await navigate({ to: '/ui-preview' });
                return;
            }
            try {
                if (mode === 'register') await $$user.signUpFx(value);
                else await $$user.signInFx(value);
            } catch {
                // The owning Effector model records expected auth errors for display below.
                return;
            }
            // Route validation refreshes the user model; navigate once per successful submission.
            await navigate({ to: '/', replace: true });
        },
    });
    return (
        <div className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
            <AuthHero />
            <main className="bg-card text-card-foreground flex flex-col justify-center px-6 py-12 sm:px-14">
                <div className="mx-auto w-full max-w-sm">
                    <Link to="/login" className="mb-10 flex w-fit items-center text-white">
                        <BrandLogo />
                    </Link>
                    <h1 className="text-3xl font-medium tracking-tight">{mode === 'register' ? 'Start with a clearer view.' : 'Welcome back.'}</h1>
                    <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                        {mode === 'register' ? 'Create an account to access your workspace.' : 'Sign in to continue to your workspace.'}
                    </p>
                    <form
                        className="mt-9 space-y-5"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void form.handleSubmit();
                        }}
                    >
                        <form.Field name="email">
                            {(field) => (
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email address</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        autoComplete="email"
                                        placeholder="you@company.com"
                                        value={field.state.value}
                                        onChange={(e) => field.handleChange(e.target.value)}
                                        required
                                    />
                                </div>
                            )}
                        </form.Field>
                        <form.Field name="password">
                            {(field) => (
                                <div className="space-y-2">
                                    <Label htmlFor="password">Password</Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                                        placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'}
                                        value={field.state.value}
                                        onChange={(e) => field.handleChange(e.target.value)}
                                        required
                                        minLength={8}
                                        maxLength={128}
                                    />
                                </div>
                            )}
                        </form.Field>
                        <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
                            {(validationError) =>
                                validationError ? (
                                    <p role="alert" className="text-destructive text-sm">
                                        {validationError}
                                    </p>
                                ) : null
                            }
                        </form.Subscribe>
                        {error && (
                            <p role="alert" className="text-destructive text-sm">
                                {error}
                            </p>
                        )}
                        <Button
                            type="submit"
                            className="mt-3 w-full"
                            loading={isPending}
                            leadingIcon={ArrowRight}
                            aria-label={isPending ? 'Please wait…' : undefined}
                        >
                            {mode === 'register' ? 'Create account' : 'Sign in'}
                        </Button>
                    </form>
                    <p className="text-muted-foreground mt-7 text-center text-sm">
                        {mode === 'register' ? 'Already have an account? ' : 'New to Pirto? '}
                        <Link className="text-primary font-medium underline-offset-4 hover:underline" to={mode === 'register' ? '/login' : '/register'}>
                            {mode === 'register' ? 'Sign in' : 'Create an account'}
                        </Link>
                    </p>
                </div>
            </main>
        </div>
    );
}
