import { z } from 'zod';
import { MongoIdZod } from './mongo-id';

const EmailZod = z.string().trim().toLowerCase().pipe(z.email());
export const SignInInputZod = z.object({ email: EmailZod, password: z.string().min(8, 'Use at least 8 characters.').max(128) });
export const SignUpInputZod = SignInInputZod;
export const UserZod = z.object({
    id: MongoIdZod,
    betterAuthUserId: MongoIdZod,
    email: z.email(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
});
export type SignInInput = z.infer<typeof SignInInputZod>;
export type SignUpInput = z.infer<typeof SignUpInputZod>;
export type User = z.infer<typeof UserZod>;
