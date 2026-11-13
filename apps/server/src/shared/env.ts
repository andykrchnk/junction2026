import { z } from 'zod';

const EnvZod = z.object({
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url().default('http://localhost:3001'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    APP_ORIGIN: z.url().default('http://localhost:3000'),
    MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
    MONGODB_DB_NAME: z.string().min(1),
});

const parsed = EnvZod.safeParse(process.env);
if (!parsed.success) {
    throw new Error(`Invalid server environment: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
}
export const Env = parsed.data;
