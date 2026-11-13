import mongoose from 'mongoose';
import { Env } from '../shared/env';

const mongo = await mongoose.connect(Env.MONGODB_URI, { dbName: Env.MONGODB_DB_NAME, serverSelectionTimeoutMS: 10_000 });
export const connection = mongo.connection;
if (!connection.db) throw new Error('Database connection is unavailable');
export const database = connection.db;
export const mongoClient = connection.getClient();
