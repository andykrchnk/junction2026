import { MongoClient } from 'mongodb';
import { Env } from '../shared/env';

export const mongoClient = new MongoClient(Env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
export const database = mongoClient.db(Env.MONGODB_DB_NAME);

export async function connectDatabase() {
    await mongoClient.connect();
    await database.command({ ping: 1 });
}
