import { app } from './hono';
import { connection } from '../db/connection';
import { db } from '../db';
import { Env } from '../shared/env';
import { startDrawingWorker } from '../features/drawings/processing-jobs';

await Promise.all([db.user.UserModel.init(), db.drawing.DrawingModel.init()]);
const worker = startDrawingWorker();
const server = Bun.serve({ hostname: '0.0.0.0', port: Env.PORT, idleTimeout: 255, fetch: app.fetch });
console.log(`API listening on port ${server.port}`);

async function shutdown() {
    await worker.stop();
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
