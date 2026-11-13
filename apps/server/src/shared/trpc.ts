import { initTRPC, TRPCError } from '@trpc/server';
import type { AuthRequestContextVariables } from '../services/better-auth';

export type TRPCContext = AuthRequestContextVariables;
export const t = initTRPC.context<TRPCContext>().create();
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.session || !ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' });
    return next({ ctx: { session: ctx.session, user: ctx.user } });
});
