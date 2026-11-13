import type { MiddlewareHandler } from 'hono';
import { db } from '../db';
import { $$betterAuth } from '../services/better-auth';
import type { AuthRequestContextVariables } from '../services/better-auth';

export const authContextMiddleware: MiddlewareHandler<{ Variables: AuthRequestContextVariables }> = async (c, next) => {
    const identity = await $$betterAuth.getSession(c.req.raw);
    c.set('authUser', identity ? { id: identity.user.id, email: identity.user.email } : null);
    c.set('session', identity?.session ?? null);
    c.set('user', identity ? await db.user.getByBetterAuthUserId(identity.user.id) : null);
    await next();
};
