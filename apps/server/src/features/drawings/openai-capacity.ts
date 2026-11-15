import { Env } from '../../shared/env';

let active = 0;
const waiting = new Set<() => void>();

// Shared by context, entity and calibration calls in this backend instance.
export async function withOpenAiCapacity<T>(signal: AbortSignal, request: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (active >= Env.DRAWING_OPENAI_CONCURRENCY) {
        await new Promise<void>((resolve, reject) => {
            const ready = () => {
                signal.removeEventListener('abort', aborted);
                resolve(); // The releasing request transfers its slot to this waiter.
            };
            const aborted = () => {
                waiting.delete(ready);
                reject(signal.reason);
            };
            waiting.add(ready);
            signal.addEventListener('abort', aborted, { once: true });
        });
    } else {
        active += 1;
    }
    try {
        signal.throwIfAborted();
        return await request();
    } finally {
        const next = waiting.values().next().value;
        if (next) {
            waiting.delete(next);
            next();
        } else {
            active -= 1;
        }
    }
}
