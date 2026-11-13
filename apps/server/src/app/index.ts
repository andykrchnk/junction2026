import { app } from './hono';
import { connection } from '../db/connection';
import { db } from '../db';
import { Env } from '../shared/env';

await db.user.UserModel.init();
const server = Bun.serve({ hostname: '0.0.0.0', port: Env.PORT, fetch: app.fetch });
console.log(`API listening on port ${server.port}`);

async function shutdown() {
    await server.stop();
    await connection.close();
    process.exit(0);
}
process.once('SIGINT', () => {
    void shutdown();
});
process.once('SIGTERM', () => {
    void shutdown();
});
