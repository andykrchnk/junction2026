import { initTRPC, TRPCError } from '@trpc/server';
import type { AuthSession } from '../services/better-auth';

export type TRPCContext = { session: AuthSession };
export const t = initTRPC.context<TRPCContext>().create();
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' });
    return next({ ctx: { session: ctx.session } });
});
