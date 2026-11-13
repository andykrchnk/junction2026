import { describe, expect, test } from 'bun:test';
import { protectedProcedure, t } from './trpc';
import type { TRPCContext } from './trpc';

const router = t.router({ identity: protectedProcedure.query(({ ctx }) => ctx.session.user.id) });

describe('protected procedures', () => {
    test('rejects unauthenticated callers', async () => {
        const caller = router.createCaller({ session: null });
        await expect(caller.identity()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    test('uses the server session identity', async () => {
        const now = new Date();
        const context: TRPCContext = {
            session: {
                user: { id: 'server-user', name: 'Test User', email: 'test@example.com', emailVerified: false, image: null, createdAt: now, updatedAt: now },
                session: {
                    id: 'test-session',
                    userId: 'server-user',
                    token: 'test-token',
                    expiresAt: new Date(now.getTime() + 60_000),
                    createdAt: now,
                    updatedAt: now,
                    ipAddress: null,
                    userAgent: null,
                },
            },
        };
        await expect(router.createCaller(context).identity()).resolves.toBe('server-user');
    });
});
