import { SystemStatusZod } from '@repo/types';
import { t } from '../shared/trpc';

export const appRouter = t.router({
    system: t.router({ status: t.procedure.output(SystemStatusZod).query(() => ({ status: 'ok', service: 'junction-api' })) }),
});

export type AppRouter = typeof appRouter;
