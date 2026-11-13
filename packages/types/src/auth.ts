import { z } from 'zod';

const EmailZod = z.string().trim().toLowerCase().pipe(z.email());
export const SignInInputZod = z.object({ email: EmailZod, password: z.string().min(8, 'Use at least 8 characters.').max(128) });
export const SignUpInputZod = SignInInputZod;
export const UserZod = z.object({ id: z.string().min(1), email: z.email() });
export type SignInInput = z.infer<typeof SignInInputZod>;
export type SignUpInput = z.infer<typeof SignUpInputZod>;
export type User = z.infer<typeof UserZod>;
