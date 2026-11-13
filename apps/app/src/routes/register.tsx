import { createFileRoute } from '@tanstack/react-router';
import { AuthForm } from '@/features/authentication/auth-form';
export const Route = createFileRoute('/register')({ component: () => <AuthForm mode="register" /> });
