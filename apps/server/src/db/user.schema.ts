import mongoose from 'mongoose';
import { z } from 'zod';
import { UserZod } from '@repo/types';
import type { User } from '@repo/types';
import { connection } from './connection';

const schema = new mongoose.Schema(
    {
        betterAuthUserId: { type: String, required: true },
        email: { type: String, required: true, trim: true, lowercase: true },
    },
    { timestamps: true, id: true, versionKey: false, bufferCommands: false },
);
schema.index({ betterAuthUserId: 1 }, { unique: true });
schema.index({ email: 1 });

type StoredUser = mongoose.InferSchemaType<typeof schema>;
export const UserModel = connection.modelNames().includes('User')
    ? connection.model<StoredUser>('User')
    : connection.model<StoredUser>('User', schema, 'users');

const StoredUserZod = UserZod.omit({ id: true, createdAt: true, updatedAt: true }).extend({
    _id: z.instanceof(mongoose.Types.ObjectId),
    createdAt: z.date(),
    updatedAt: z.date(),
});
const IdentityInputZod = UserZod.pick({ betterAuthUserId: true, email: true });
type IdentityInput = z.infer<typeof IdentityInputZod>;

export function UserDto(data: unknown): User {
    const user = StoredUserZod.parse(data);
    return {
        id: user._id.toHexString(),
        betterAuthUserId: user.betterAuthUserId,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
    };
}

export async function getByBetterAuthUserId(betterAuthUserId: string): Promise<User | null> {
    const user = await UserModel.findOne({ betterAuthUserId }).lean();
    return user ? UserDto(user) : null;
}

export async function create(input: IdentityInput): Promise<User> {
    const user = await UserModel.create(IdentityInputZod.parse(input));
    return UserDto(user.toObject());
}
