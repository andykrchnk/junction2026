import { drawingFiles } from '../features/drawings/files';
import { $$betterAuth } from '../services/better-auth';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { trpcServer } from '@hono/trpc-server';
import { Env } from '../shared/env';
import { database } from '../db/connection';
import { appRouter } from '../trpc/app.trpc';
import { z } from 'zod';
import { UserZod } from '@repo/types';
import { $$userCreationService } from '../services/user-creation.service';
import { authContextMiddleware } from '../middlewares/auth-context.middleware';
import type { AuthRequestContextVariables } from '../services/better-auth';

const RegistrationResponseZod = z.object({ user: z.object({ id: UserZod.shape.betterAuthUserId, email: UserZod.shape.email }) });

export const app = new Hono<{ Variables: AuthRequestContextVariables }>();
app.use('*', secureHeaders());
app.use('/api/*', cors({ origin: Env.APP_ORIGIN, credentials: true, exposeHeaders: ['set-auth-token'] }));
app.get('/health', async (c) => {
    await database.command({ ping: 1 });
    return c.json({ status: 'ok' });
});
app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    // Keep Better Auth's validation, rate limits and session headers on the normal signup endpoint.
    const response = await $$betterAuth.handler(c.req.raw);
    const isRegistration = c.req.method === 'POST' && c.req.path.replace(/\/+$/, '') === '/api/auth/sign-up/email';
    if (!response.ok || !isRegistration) return response;
    const { user } = RegistrationResponseZod.parse(await response.clone().json());
    await $$userCreationService.create({ betterAuthUserId: user.id, email: user.email });
    return response;
});
app.use('/api/drawings/*', authContextMiddleware);
app.route('/api/drawings', drawingFiles);
app.use('/api/trpc/*', authContextMiddleware);
app.use(
    '/api/trpc/*',
    trpcServer({
        router: appRouter,
        endpoint: '/api/trpc',
        createContext: (_options, c) => ({ session: c.get('session'), authUser: c.get('authUser'), user: c.get('user') }),
    }),
);
app.onError((error, c) => {
    console.error('Request failed', { name: error.name });
    return c.json({ message: 'The server could not complete this request.' }, 500);
});
