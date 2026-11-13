import { createEffect, createEvent, createStore, sample } from 'effector';
import { combine } from 'effector';
import { readonly } from 'patronum';
import { TRPCClientError } from '@trpc/client';
import { SignInInputZod, SignUpInputZod, UserZod } from '@repo/types';
import type { SignInInput, SignUpInput, User } from '@repo/types';
import { authClient, clearBearerToken, getAuthVersion } from '@/shared/auth';
import { queryClient, trpcClient } from '@/shared/trpc';

type SessionState = { type: 'idle' } | { type: 'loading' } | { type: 'authenticated'; user: User } | { type: 'anonymous' } | { type: 'error' };
const sessionCleared = createEvent();
const formOpened = createEvent();
const $session = createStore<SessionState>({ type: 'idle' });
const $error = createStore<string | null>(null);

const getUserFx = createEffect(async () => {
    const version = getAuthVersion();
    try {
        return { user: UserZod.parse(await trpcClient.me.query()), version };
    } catch (error) {
        if (error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED') return { user: null, version };
        throw error;
    }
});
const signInFx = createEffect(async (input: SignInInput) => {
    const { error } = await authClient.signIn.email(SignInInputZod.parse(input));
    if (error) throw new Error(error.message ?? 'Could not sign in. Please try again.');
    const { user } = await getUserFx();
    if (!user) throw new Error('Your session could not be verified. Please sign in again.');
});
const signUpFx = createEffect(async (input: SignUpInput) => {
    const { error } = await authClient.signUp.email(SignUpInputZod.parse(input));
    if (error) throw new Error(error.message ?? 'Could not create your account. Please try again.');
    const { user } = await getUserFx();
    if (!user) throw new Error('Your session could not be verified. Please sign in again.');
});
const signOutFx = createEffect(async () => {
    const { error } = await authClient.signOut();
    if (error) throw new Error(error.message ?? 'Could not sign out. Please try again.');
    clearBearerToken();
    queryClient.clear();
});
const $isPending = combine(signInFx.pending, signUpFx.pending, signOutFx.pending, (signIn, signUp, signOut) => signIn || signUp || signOut);
const $user = $session.map((state) => (state.type === 'authenticated' ? state.user : null));

sample({ clock: getUserFx, fn: (): SessionState => ({ type: 'loading' }), target: $session });
sample({
    clock: getUserFx.doneData,
    filter: ({ version }) => version === getAuthVersion(),
    fn: ({ user }): SessionState => (user ? { type: 'authenticated', user } : { type: 'anonymous' }),
    target: $session,
});
sample({ clock: getUserFx.fail, fn: (): SessionState => ({ type: 'error' }), target: $session });
sample({ clock: signOutFx.done, target: sessionCleared });
sample({ clock: sessionCleared, fn: (): SessionState => ({ type: 'anonymous' }), target: $session });
sample({ clock: [formOpened, signInFx, signUpFx, signOutFx], fn: () => null, target: $error });
sample({ clock: [signInFx.failData, signUpFx.failData, signOutFx.failData], fn: (error) => error.message, target: $error });

export const $$user = {
    $session: readonly($session),
    $user: readonly($user),
    $error: readonly($error),
    $isPending: readonly($isPending),
    getUserFx,
    signInFx,
    signUpFx,
    signOutFx,
    formOpened,
};
