import { app } from './hono';
import { connectDatabase, mongoClient } from '../db/connection';
import { Env } from '../shared/env';

await connectDatabase();
const server = Bun.serve({ hostname: '0.0.0.0', port: Env.PORT, fetch: app.fetch });
console.log(`API listening on port ${server.port}`);

async function shutdown() {
    await server.stop();
    await mongoClient.close();
    process.exit(0);
}
process.once('SIGINT', () => {
    void shutdown();
});
process.once('SIGTERM', () => {
    void shutdown();
});
