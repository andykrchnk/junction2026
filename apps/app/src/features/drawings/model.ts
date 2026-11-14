import { createEffect, createEvent, createStore, sample } from 'effector';
import { readonly } from 'patronum';
import {
    CanvasActionAcknowledgmentZod,
    type AcknowledgeCanvasAction,
    DrawingTraceEventZod,
    type DrawingTraceEvent,
    MAX_FILE_BYTES,
    UploadErrorZod,
    type Drawing,
    type UpdateDrawingUpload,
    type BoundingBox,
    type ReviewDrawingContext,
} from '@repo/types';
import { authenticatedFetch } from '@/shared/auth';
import { config } from '@/shared/config';
import { queryClient, trpc, trpcClient } from '@/shared/trpc';

const canvasSelectionRequested = createEvent<{ id: string; page: number; index: number }>();
export type CanvasRegion = Readonly<{ page: number; bounds: BoundingBox | null; label: string }>;
const canvasRegionRequested = createEvent<CanvasRegion & { id: string }>();
const traceReceived = createEvent<{ key: string; event: DrawingTraceEvent }>();
const traceConnectionChanged = createEvent<{ key: string; error: string | null }>();
const stageChanged = createEvent<{ id: string; label: string }>();

const uploadRequested = createEvent<{ id: string; files: File[] }>();
const opened = createEvent<string | null>();
const draftChanged = createEvent<string>();
const operationStarted = createEvent<string>();
const operationFinished = createEvent<string>();
const $traceEvents = createStore<Record<string, DrawingTraceEvent[]>>({});
const $traceErrors = createStore<Record<string, string | null>>({});
const $uploadQueue = createStore<{ id: string; files: File[] }[]>([]);
const $stages = createStore<Record<string, string>>({});
const $outgoing = createStore<Record<string, Drawing['messages'][number] | undefined>>({});
const $id = createStore<string | null>(null);
const $draft = createStore('');
const $activity = createStore<Record<string, number>>({});
const $error = createStore<{ id: string | null; message: string } | null>(null);
const $inferenceError = createStore<{ id: string; message: string } | null>(null);
const refresh = async (id?: string) => {
    await Promise.all([
        queryClient.invalidateQueries(trpc.drawings.list.queryFilter()),
        ...(id ? [queryClient.invalidateQueries(trpc.drawings.get.queryFilter({ id }))] : []),
    ]);
};
const acknowledgeCanvasActionFx = createEffect(async (input: AcknowledgeCanvasAction) =>
    CanvasActionAcknowledgmentZod.parse(await trpcClient.drawings.acknowledgeCanvasAction.mutate(input)),
);
const connectTraceFx = createEffect(({ id, messageId, after }: { id: string; messageId: string; after: number }) => {
    const key = `${id}/${messageId}`;
    const subscription = trpcClient.drawings.trace.subscribe(
        { id, messageId, after },
        {
            onData: ({ data }) => traceReceived({ key, event: DrawingTraceEventZod.parse(data) }),
            onError: () => traceConnectionChanged({ key, error: 'Live activity is disconnected. Saved progress will refresh.' }),
            onStarted: () => traceConnectionChanged({ key, error: null }),
        },
    );
    return () => subscription.unsubscribe();
});
const updateUploadFx = createEffect(async (input: UpdateDrawingUpload) => {
    const drawing = await trpcClient.drawings.updateUpload.mutate(input);
    await refresh(input.id);
    return drawing;
});
const renameFx = createEffect(async (input: { id: string; title: string }) => {
    const drawing = await trpcClient.drawings.rename.mutate(input);
    await refresh(input.id);
    return drawing;
});
const createFx = createEffect(async () => {
    const drawing = await trpcClient.drawings.create.mutate();
    await refresh();
    return drawing;
});
const uploadFx = createEffect(async ({ id, files }: { id: string; files: File[] }) => {
    const failures: string[] = [];
    for (const file of files) {
        try {
            if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) throw new Error('Choose a PDF, PNG or JPG.');
            if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Choose a file between 1 byte and 20 MB.');
            const body = new FormData();
            body.set('file', file);
            const response = await authenticatedFetch(`${config.API_URL}/api/drawings/${id}/file`, { method: 'POST', body });
            if (!response.ok) {
                const result = UploadErrorZod.safeParse(await response.json());
                throw new Error(result.success ? result.data.message : 'Upload failed. Please retry.');
            }
        } catch (error) {
            failures.push(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed.'}`);
        }
    }
    await refresh(id);
    if (failures.length) throw new Error(failures.join('\n'));
    return id;
});
// Processing belongs to the backend. These effects only enqueue explicit retries.
const inferFx = createEffect(async (id: string) => {
    const drawing = await trpcClient.drawings.analyze.mutate({ id });
    await refresh(id);
    return drawing;
});
const analyzeFx = createEffect(async (id: string) => {
    const drawing = await trpcClient.drawings.analyze.mutate({ id });
    await refresh(id);
    return drawing;
});
const askFx = createEffect(async (input: { id: string; message: Drawing['messages'][number] }) => {
    try {
        stageChanged({ id: input.id, label: 'Reviewing blueprint evidence' });
        return await trpcClient.drawings.ask.mutate({ id: input.id, message: { id: input.message.id, question: input.message.question } });
    } finally {
        await refresh(input.id);
    }
});
const reviewContextFx = createEffect(async (input: ReviewDrawingContext) => {
    try {
        return await trpcClient.drawings.reviewContext.mutate(input);
    } finally {
        await refresh(input.id);
    }
});
const stopFx = createEffect(async (input: { id: string; messageId: string }) => {
    try {
        return await trpcClient.drawings.stop.mutate(input);
    } finally {
        await refresh(input.id);
    }
});

sample({
    clock: traceReceived,
    source: $traceEvents,
    fn: (history, { key, event }) => ({
        ...history,
        [key]: [...(history[key] ?? []).filter((previous) => previous.sequence !== event.sequence), event].sort((a, b) => a.sequence - b.sequence),
    }),
    target: $traceEvents,
});
sample({ clock: traceConnectionChanged, source: $traceErrors, fn: (errors, { key, error }) => ({ ...errors, [key]: error }), target: $traceErrors });
sample({ clock: uploadRequested, source: $uploadQueue, fn: (queue, request) => [...queue, request], target: $uploadQueue });
sample({
    clock: [uploadRequested, uploadFx.finally],
    source: { queue: $uploadQueue, pending: uploadFx.pending },
    filter: ({ queue, pending }) => !pending && queue.length > 0,
    fn: ({ queue }) => queue[0],
    target: uploadFx,
});
sample({ clock: uploadFx, source: $uploadQueue, fn: (queue) => queue.slice(1), target: $uploadQueue });
sample({ clock: stageChanged, source: $stages, fn: (stages, { id, label }) => ({ ...stages, [id]: label }), target: $stages });
sample({ clock: uploadFx, fn: ({ id }) => ({ id, label: 'Uploading blueprint' }), target: stageChanged });
sample({ clock: inferFx, fn: (id) => ({ id, label: 'Preparing blueprint' }), target: stageChanged });
sample({ clock: askFx, source: $outgoing, fn: (outgoing, { id, message }) => ({ ...outgoing, [id]: message }), target: $outgoing });
sample({ clock: askFx.done, source: $outgoing, fn: (outgoing, { params }) => ({ ...outgoing, [params.id]: undefined }), target: $outgoing });
sample({ clock: askFx, source: $id, filter: (id, params) => id === params.id, fn: () => '', target: $draft });
sample({ clock: uploadFx, fn: ({ id }) => id, target: operationStarted });
sample({ clock: analyzeFx, target: operationStarted });
sample({ clock: askFx, fn: ({ id }) => id, target: operationStarted });
sample({ clock: reviewContextFx, fn: ({ id }) => id, target: operationStarted });
sample({
    clock: reviewContextFx,
    fn: ({ id, section }) => ({ id, label: section === 'scale' ? 'Reviewing drawing scale' : 'Reading drawing notes' }),
    target: stageChanged,
});
sample({ clock: reviewContextFx.finally, fn: ({ params }) => params.id, target: operationFinished });
sample({ clock: reviewContextFx.fail, fn: ({ params, error }) => ({ id: params.id, message: error.message }), target: $error });
sample({ clock: uploadFx.finally, fn: ({ params }) => params.id, target: operationFinished });
sample({ clock: analyzeFx.finally, fn: ({ params }) => params, target: operationFinished });
sample({ clock: askFx.finally, fn: ({ params }) => params.id, target: operationFinished });
sample({ clock: operationStarted, source: $activity, fn: (activity, id) => ({ ...activity, [id]: (activity[id] ?? 0) + 1 }), target: $activity });
sample({ clock: operationFinished, source: $activity, fn: (activity, id) => ({ ...activity, [id]: Math.max(0, (activity[id] ?? 0) - 1) }), target: $activity });
sample({ clock: opened, target: $id });
sample({ clock: opened, fn: () => ({}), target: [$traceEvents, $traceErrors] });
sample({ clock: draftChanged, target: $draft });
sample({ clock: opened, fn: () => '', target: $draft });
sample({ clock: [opened, createFx, uploadFx, analyzeFx, askFx, reviewContextFx], fn: () => null, target: $error });
sample({ clock: acknowledgeCanvasActionFx.fail, fn: ({ params, error }) => ({ id: params.id, message: error.message }), target: $error });
sample({ clock: createFx.failData, fn: (error) => ({ id: null, message: error.message }), target: $error });
sample({ clock: uploadFx.fail, fn: ({ params, error }) => ({ id: params.id, message: error.message }), target: $error });
sample({ clock: analyzeFx.fail, fn: ({ params, error }) => ({ id: params, message: error.message }), target: $error });
sample({ clock: askFx.fail, fn: ({ params, error }) => ({ id: params.id, message: error.message }), target: $error });
sample({ clock: stopFx, fn: () => null, target: $error });
sample({ clock: stopFx.fail, fn: ({ params, error }) => ({ id: params.id, message: error.message }), target: $error });
sample({ clock: askFx.done, source: $id, filter: (id, { params }) => id === params.id, fn: () => '', target: $draft });
sample({ clock: [opened, inferFx], fn: () => null, target: $inferenceError });
sample({ clock: inferFx.fail, fn: ({ params, error }) => ({ id: params, message: error.message }), target: $inferenceError });

export const $$drawings = {
    acknowledgeCanvasActionFx,
    connectTraceFx,
    $traceEvents: readonly($traceEvents),
    $traceErrors: readonly($traceErrors),
    uploadRequested,
    canvasRegionRequested,
    reviewContextFx,
    canvasSelectionRequested,
    opened,
    renameFx,
    updateUploadFx,
    draftChanged,
    createFx,
    uploadFx,
    analyzeFx,
    inferFx,
    askFx,
    stopFx,
    $stopping: readonly(stopFx.pending),
    $outgoing: readonly($outgoing),
    $stages: readonly($stages),
    $draft: readonly($draft),
    $error: readonly($error),
    $inferenceError: readonly($inferenceError),
    $inferring: readonly(inferFx.pending),
    $creating: readonly(createFx.pending),
    $uploading: readonly(uploadFx.pending),
    $activity: readonly($activity),
    $asking: readonly(askFx.pending),
};
