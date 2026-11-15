type DeadlineParams<T> = Readonly<{
    signal: AbortSignal;
    timeoutMs: number;
    label: string;
    run: (signal: AbortSignal) => Promise<T>;
}>;

export class DeadlineError extends Error {}

// SDK cancellation is cooperative. Race it so an unresponsive request cannot retain a job lock.
export async function withDeadline<T>(params: DeadlineParams<T>): Promise<T> {
    params.signal.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([params.signal, controller.signal]);
    const timeout = setTimeout(
        () => controller.abort(new DeadlineError(`${params.label} timed out after ${Math.round(params.timeoutMs / 1000)} seconds.`)),
        params.timeoutMs,
    );
    let cancel = () => {};
    const aborted = new Promise<never>((_, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
    });
    try {
        return await Promise.race([
            Promise.resolve().then(() => {
                signal.throwIfAborted();
                return params.run(signal);
            }),
            aborted,
        ]);
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', cancel);
    }
}
