import { describe, expect, test } from 'bun:test';
import { SignInInputZod, SignUpInputZod } from './auth';

describe('account inputs', () => {
    test('normalizes email consistently for sign-in and registration', () => {
        const input = { email: '  Alex@Example.com ', password: 'test-password', name: ' Alex Morgan ' };
        expect(SignInInputZod.parse(input).email).toBe('alex@example.com');
        expect(SignUpInputZod.parse(input)).toMatchObject({ email: 'alex@example.com', name: 'Alex Morgan' });
    });
    test('rejects invalid credentials and incomplete registration', () => {
        expect(SignInInputZod.safeParse({ email: 'not-an-email', password: 'short' }).success).toBe(false);
        expect(SignUpInputZod.safeParse({ email: 'alex@example.com', password: 'test-password', name: '' }).success).toBe(false);
    });
});
