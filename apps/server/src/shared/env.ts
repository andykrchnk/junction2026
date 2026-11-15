import { z } from 'zod';

const EnvZod = z
    .object({
        OPENAI_API_KEY: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional()),
        INFERENCE_BASE_URL: z.preprocess(
            (value) => (value === '' ? undefined : value),
            z
                .url()
                .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))
                .optional(),
        ),
        INFERENCE_API_KEY: z.preprocess(
            (value) => (value === '' ? undefined : value),
            z
                .string()
                .min(32)
                .regex(/^[\x20-\x7e]+$/)
                .optional(),
        ),
        INFERENCE_TIMEOUT_MS: z.preprocess((value) => (value === '' ? undefined : value), z.coerce.number().int().min(5000).max(240000).default(240000)),
        DRAWING_PROCESSING_CONCURRENCY: z.preprocess((value) => (value === '' ? undefined : value), z.coerce.number().int().min(1).max(32).default(15)),
        DRAWING_OPENAI_CONCURRENCY: z.preprocess((value) => (value === '' ? undefined : value), z.coerce.number().int().min(1).max(64).default(18)),
        DRAWING_ENTITY_CONCURRENCY: z.preprocess((value) => (value === '' ? undefined : value), z.coerce.number().int().min(1).max(12).default(6)),
        BETTER_AUTH_SECRET: z.string().min(32),
        BETTER_AUTH_URL: z.url().default('http://localhost:3001'),
        ALLOW_SIGNUP: z
            .enum(['true', 'false'])
            .default('true')
            .transform((value) => value === 'true'),
        PORT: z.coerce.number().int().min(1).max(65535).default(3001),
        APP_ORIGIN: z.url().default('http://localhost:3000'),
        MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
        MONGODB_DB_NAME: z.string().min(1),
    })
    .superRefine((value, ctx) => {
        if (Boolean(value.INFERENCE_BASE_URL) !== Boolean(value.INFERENCE_API_KEY)) {
            ctx.addIssue({ code: 'custom', path: ['INFERENCE_BASE_URL'], message: 'Configure both inference URL and API key, or neither.' });
        }
    });

const parsed = EnvZod.safeParse(process.env);
if (!parsed.success) {
    throw new Error(`Invalid server environment: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
}
export const Env = parsed.data;
