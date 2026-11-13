import { SystemStatusZod, UserZod } from '@repo/types';
import { protectedProcedure, t } from '../shared/trpc';

export const appRouter = t.router({
    system: t.router({ status: t.procedure.output(SystemStatusZod).query(() => ({ status: 'ok', service: 'junction-api' })) }),
    me: protectedProcedure.output(UserZod).query(({ ctx }) => UserZod.parse(ctx.session.user)),
});
export type AppRouter = typeof appRouter;
