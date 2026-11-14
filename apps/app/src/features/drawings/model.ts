import { createEffect, createEvent, createStore, sample } from 'effector';
import { readonly } from 'patronum';
import { MAX_FILE_BYTES, UploadErrorZod, type Drawing } from '@repo/types';
import { authenticatedFetch } from '@/shared/auth';
import { config } from '@/shared/config';
import { queryClient, trpc, trpcClient } from '@/shared/trpc';

const opened = createEvent<string | null>();
const draftChanged = createEvent<string>();
const operationStarted = createEvent<string>();
const operationFinished = createEvent<string>();
const $id = createStore<string | null>(null);
const $draft = createStore('');
const $activity = createStore<Record<string, number>>({});
const $error = createStore<{ id: string | null; message: string } | null>(null);
const refresh = async (id?: string) => {
    await Promise.all([
        queryClient.invalidateQueries(trpc.drawings.list.queryFilter()),
        ...(id ? [queryClient.invalidateQueries(trpc.drawings.get.queryFilter({ id }))] : []),
    ]);
};
const createFx = createEffect(async () => {
    const drawing = await trpcClient.drawings.create.mutate();
    await refresh();
    return drawing;
});
const uploadFx = createEffect(async ({ id, file }: { id: string; file: File }) => {
    if (file.size > MAX_FILE_BYTES) throw new Error('Choose a file no larger than 20 MB.');
    const body = new FormData();
    body.set('file', file);
    const response = await authenticatedFetch(`${config.API_URL}/api/drawings/${id}/file`, { method: 'POST', body });
    if (!response.ok) {
        const result = UploadErrorZod.safeParse(await response.json());
        throw new Error(result.success ? result.data.message : 'Upload failed. Please retry.');
    }
    await refresh(id);
    return id;
});
const analyzeFx = createEffect(async (id: string) => {
    try {
        return await trpcClient.drawings.analyze.mutate({ id });
    } finally {
        await refresh(id);
    }
});
const askFx = createEffect(async (input: { id: string; message: Drawing['messages'][number] }) => {
    try {
        const drawing = await trpcClient.drawings.get.query({ id: input.id });
        if (!drawing.analysis) await trpcClient.drawings.analyze.mutate({ id: input.id });
        return await trpcClient.drawings.ask.mutate({ id: input.id, message: { id: input.message.id, question: input.message.question } });
    } finally {
        await refresh(input.id);
    }
});

sample({ clock: uploadFx, fn: ({ id }) => id, target: operationStarted });
sample({ clock: analyzeFx, target: operationStarted });
sample({ clock: askFx, fn: ({ id }) => id, target: operationStarted });
sample({ clock: uploadFx.finally, fn: ({ params }) => params.id, target: operationFinished });
sample({ clock: analyzeFx.finally, fn: ({ params }) => params, target: operationFinished });
sample({ clock: askFx.finally, fn: ({ params }) => params.id, target: operationFinished });
sample({ clock: operationStarted, source: $activity, fn: (activity, id) => ({ ...activity, [id]: (activity[id] ?? 0) + 1 }), target: $activity });
sample({ clock: operationFinished, source: $activity, fn: (activity, id) => ({ ...activity, [id]: Math.max(0, (activity[id] ?? 0) - 1) }), target: $activity });
sample({ clock: opened, target: $id });
sample({ clock: draftChanged, target: $draft });
sample({ clock: opened, fn: () => '', target: $draft });
sample({ clock: [opened, createFx, uploadFx, analyzeFx, askFx], fn: () => null, target: $error });
sample({ clock: createFx.failData, fn: (error) => ({ id: null, message: error.message }), target: $error });
sample({ clock: uploadFx.fail, fn: ({ params, error }) => ({ id: params.id, message: error.message }), target: $error });
sample({ clock: analyzeFx.fail, fn: ({ params, error }) => ({ id: params, message: error.message }), target: $error });
sample({ clock: askFx.fail, fn: ({ params, error }) => ({ id: params.id, message: error.message }), target: $error });
sample({ clock: askFx.done, source: $id, filter: (id, { params }) => id === params.id, fn: () => '', target: $draft });
sample({ clock: uploadFx.doneData, target: analyzeFx });

export const $$drawings = {
    opened,
    draftChanged,
    createFx,
    uploadFx,
    analyzeFx,
    askFx,
    $draft: readonly($draft),
    $error: readonly($error),
    $creating: readonly(createFx.pending),
    $uploading: readonly(uploadFx.pending),
    $activity: readonly($activity),
    $asking: readonly(askFx.pending),
};
