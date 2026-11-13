import { z } from 'zod';

export const MongoIdZod = z.string().regex(/^[a-fA-F0-9]{24}$/);

export type MongoId = z.infer<typeof MongoIdZod>;
