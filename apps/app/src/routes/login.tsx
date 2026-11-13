import { createFileRoute } from '@tanstack/react-router';
import { AuthForm } from '@/features/authentication/auth-form';
export const Route = createFileRoute('/login')({ component: () => <AuthForm mode="sign-in" /> });
