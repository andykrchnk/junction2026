import { betterAuth } from 'better-auth';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { bearer } from 'better-auth/plugins';
import { database, mongoClient } from '../db/connection';
import { Env } from '../shared/env';
import type { User } from '@repo/types';

const auth = betterAuth({
    database: mongodbAdapter(database, { client: mongoClient }),
    baseURL: Env.BETTER_AUTH_URL,
    secret: Env.BETTER_AUTH_SECRET,
    trustedOrigins: [Env.APP_ORIGIN],
    user: { modelName: 'betterauth-users' },
    account: { modelName: 'betterauth-accounts' },
    session: { modelName: 'betterauth-sessions', cookieCache: { enabled: false } },
    verification: { modelName: 'betterauth-verifications' },
    emailAndPassword: { enabled: true, disableSignUp: !Env.ALLOW_SIGNUP, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
    rateLimit: { enabled: true, storage: 'database' },
    plugins: [bearer()],
});

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
export type AuthRequestContextVariables = {
    authUser: Pick<NonNullable<AuthSession>['user'], 'id' | 'email'> | null;
    session: NonNullable<AuthSession>['session'] | null;
    user: User | null;
};
export const $$betterAuth = {
    handler: auth.handler,
    getSession(request: Request) {
        const headers = new Headers(request.headers);
        if (headers.has('authorization')) headers.delete('cookie');
        return auth.api.getSession({ headers });
    },
    async deleteUser(input: { betterAuthUserId: string }) {
        const context = await auth.$context;
        await context.internalAdapter.deleteUser(input.betterAuthUserId);
    },
};
