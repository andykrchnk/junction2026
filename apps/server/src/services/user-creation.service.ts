import { db } from '../db';
import { $$betterAuth } from './better-auth';
import type { User } from '@repo/types';

async function create(input: Pick<User, 'betterAuthUserId' | 'email'>): Promise<User> {
    try {
        return await db.user.create(input);
    } catch (error) {
        // Better Auth has already committed the identity; compensate if profile creation fails.
        try {
            await $$betterAuth.deleteUser({ betterAuthUserId: input.betterAuthUserId });
        } catch (cleanupError) {
            console.error('Failed to clean up identity after application user creation failed', {
                name: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
            });
        }
        throw error;
    }
}

export const $$userCreationService = { create };
