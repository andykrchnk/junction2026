import { useForm } from '@tanstack/react-form';
import { Link, useNavigate } from '@tanstack/react-router';
import { useUnit } from 'effector-react';
import { useEffect } from 'react';
import { ArrowRight, Layers3 } from 'lucide-react';
import { SignInInputZod, SignUpInputZod } from '@repo/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { $$user } from '@/entities/user/model';

type AuthFormProps = { mode: 'sign-in' | 'register' };
export function AuthForm(props: Readonly<AuthFormProps>) {
    const { mode } = props;
    const { error, isPending, user } = useUnit({ error: $$user.$error, isPending: $$user.$isPending, user: $$user.$user });
    const navigate = useNavigate();
    useEffect(() => {
        $$user.formOpened();
    }, [mode]);
    useEffect(() => {
        if (user) void navigate({ to: '/', replace: true });
    }, [user, navigate]);
    const form = useForm({
        defaultValues: { email: '', password: '' },
        validators: {
            onSubmit: ({ value }) => {
                const result = (mode === 'register' ? SignUpInputZod : SignInInputZod).safeParse(value);
                return result.success ? undefined : result.error.issues[0]?.message;
            },
        },
        onSubmit: async ({ value }) => {
            // The owning Effector model records expected auth errors for display below.
            if (mode === 'register') await $$user.signUpFx(value).catch(() => undefined);
            else await $$user.signInFx(value).catch(() => undefined);
        },
    });
    return (
        <div className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
            <aside className="bg-primary text-primary-foreground relative hidden flex-col overflow-hidden p-12 lg:flex">
                <Link to="/login" className="flex items-center gap-3 text-xl font-semibold tracking-tight">
                    <Layers3 className="size-6" />
                    junction.
                </Link>
                <div aria-hidden="true" className="absolute inset-x-12 top-[28%] aspect-[1.25] border border-current/15 p-8">
                    <div className="grid h-full grid-cols-[1fr_1.5fr] gap-3">
                        <div className="border border-current/30" />
                        <div className="grid grid-rows-[1fr_0.7fr] gap-3">
                            <div className="border border-current/30" />
                            <div className="grid grid-cols-2 gap-3">
                                <div className="border border-current/30" />
                                <div className="border border-current/30" />
                            </div>
                        </div>
                    </div>
                    <span className="absolute -bottom-7 right-0 text-[10px] tracking-[0.2em] uppercase opacity-60">01 / A clearer view</span>
                </div>
                <div className="mt-auto max-w-md">
                    <p className="mb-5 text-xs tracking-[0.18em] uppercase opacity-65">Built on evidence</p>
                    <h2 className="text-4xl leading-tight font-medium tracking-tight">
                        Less searching.
                        <br />
                        More understanding.
                    </h2>
                    <p className="mt-5 text-sm leading-relaxed opacity-75">
                        Bring your construction drawings into one workspace. Make every answer traceable to its source.
                    </p>
                </div>
            </aside>
            <main className="flex flex-col justify-center px-6 py-12 sm:px-14">
                <div className="mx-auto w-full max-w-sm">
                    <Link to="/login" className="mb-14 flex items-center gap-2 text-lg font-semibold lg:hidden">
                        <Layers3 className="size-5" />
                        junction.
                    </Link>
                    <p className="text-primary mb-3 text-xs font-semibold tracking-[0.14em] uppercase">Your drawing workspace</p>
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
                        {mode === 'register' ? 'Already have an account? ' : 'New to Junction? '}
                        <Link className="text-primary font-medium underline-offset-4 hover:underline" to={mode === 'register' ? '/login' : '/register'}>
                            {mode === 'register' ? 'Sign in' : 'Create an account'}
                        </Link>
                    </p>
                    <p className="text-muted-foreground mt-16 text-xs">Junction 2026 · Construction intelligence</p>
                </div>
            </main>
        </div>
    );
}
