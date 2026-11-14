import { z } from 'zod';

const ConfigZod = z.object({ VITE_API_URL: z.url().default('http://localhost:3001'), VITE_TLDRAW_LICENSE_KEY: z.string().optional() });
const parsed = ConfigZod.safeParse(import.meta.env);
if (!parsed.success) throw new Error('Invalid public API URL configuration');
export const config = { API_URL: parsed.data.VITE_API_URL.replace(/\/$/, ''), TLDRAW_LICENSE_KEY: parsed.data.VITE_TLDRAW_LICENSE_KEY };
