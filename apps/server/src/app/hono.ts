import { $$betterAuth } from '../services/better-auth';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { trpcServer } from '@hono/trpc-server';
import { Env } from '../shared/env';
import { database } from '../db/connection';
import { appRouter } from '../trpc/app.trpc';

export const app = new Hono();
app.use('*', secureHeaders());
app.use('/api/*', cors({ origin: Env.APP_ORIGIN, credentials: true, exposeHeaders: ['set-auth-token'] }));
app.get('/health', async (c) => {
    await database.command({ ping: 1 });
    return c.json({ status: 'ok' });
});
app.on(['GET', 'POST'], '/api/auth/*', (c) => $$betterAuth.handler(c.req.raw));
app.use(
    '/api/trpc/*',
    trpcServer({ router: appRouter, endpoint: '/api/trpc', createContext: async (_options, c) => ({ session: await $$betterAuth.getSession(c.req.raw) }) }),
);
app.onError((error, c) => {
    console.error('Request failed', { name: error.name });
    return c.json({ message: 'The server could not complete this request.' }, 500);
});
