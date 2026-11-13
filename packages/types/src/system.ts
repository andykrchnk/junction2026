import { z } from 'zod';

export const SystemStatusZod = z.object({ status: z.literal('ok'), service: z.literal('junction-api') });
export type SystemStatus = z.infer<typeof SystemStatusZod>;
