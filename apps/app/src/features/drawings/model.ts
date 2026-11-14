import { createEffect, createEvent, createStore, sample } from 'effector';
import { readonly } from 'patronum';
import { MAX_FILE_BYTES, UploadErrorZod, type Drawing, type UpdateDrawingUpload } from '@repo/types';
import { authenticatedFetch } from '@/shared/auth';
import { config } from '@/shared/config';
import { queryClient, trpc, trpcClient } from '@/shared/trpc';

const stageChanged = createEvent<{ id: string; label: string }>();

const opened = createEvent<string | null>();
const draftChanged = createEvent<string>();
const analysisRequested = createEvent<string>();
const operationStarted = createEvent<string>();
const operationFinished = createEvent<string>();
const $stages = createStore<Record<string, string>>({});
const $outgoing = createStore<Record<string, Drawing['messages'][number] | undefined>>({});
const $id = createStore<string | null>(null);
const $draft = createStore('');
const $activity = createStore<Record<string, number>>({});
const $error = createStore<{ id: string | null; message: string } | null>(null);
const $inferenceError = createStore<{ id: string; message: string } | null>(null);
const $analysisRunning = createStore<Record<string, boolean>>({});
const refresh = async (id?: string) => {
    await Promise.all([
        queryClient.invalidateQueries(trpc.drawings.list.queryFilter()),
        ...(id ? [queryClient.invalidateQueries(trpc.drawings.get.queryFilter({ id }))] : []),
    ]);
};
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
async function waitForInference(params: { id: string; deadline: number }): Promise<Drawing> {
    const drawing = await trpcClient.drawings.get.query({ id: params.id });
    queryClient.setQueryData(trpc.drawings.get.queryOptions({ id: params.id }).queryKey, drawing);
    if (drawing.detection?.status !== 'processing' || Date.now() >= params.deadline) return drawing;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(2000, Math.max(0, params.deadline - Date.now()))));
    return waitForInference(params);
}
const inferFx = createEffect(async (id: string) => {
    const drawing = await waitForInference({ id, deadline: Date.now() + 300_000 });
    if (!drawing.attachment || drawing.detection?.status === 'processing') return drawing;
    const completed = new Set(drawing.detection?.pages.map((page) => page.page) ?? []);
    // The service accepts one image at a time. Persist each page before requesting the next.
    for (const page of Array.from({ length: drawing.attachment.pages }, (_, index) => index + 1)) {
        if (completed.has(page)) continue;
        try {
            const updated = await trpcClient.drawings.detect.mutate({ id, page });
            if (updated.detection?.status === 'not_configured') return updated;
        } finally {
            await refresh(id);
        }
    }
    return trpcClient.drawings.get.query({ id });
});
const analyzeFx = createEffect(async (id: string) => {
    try {
        const drawing = await trpcClient.drawings.get.query({ id });
        if (!drawing.attachment || (drawing.analysis && drawing.ppmCandidates != null && drawing.ppm != null)) return drawing;
        const detected = await inferFx(id);
        if (detected.detection?.status !== 'ready') {
            const status = detected.detection?.status;
            const message =
                status === 'not_configured'
                    ? 'Object detection is not configured. Connect the inference service, then retry analysis.'
                    : status === 'processing'
                      ? 'Object detection is still running. Wait a moment, then retry analysis.'
                      : (detected.detection?.error ?? 'Object detection has not finished. Retry analysis to resume the remaining pages.');
            throw new Error(message);
        }
        stageChanged({ id, label: 'Reviewing blueprint' });
        return await trpcClient.drawings.analyze.mutate({ id });
    } finally {
        await refresh(id);
    }
});
const askFx = createEffect(async (input: { id: string; message: Drawing['messages'][number] }) => {
    try {
        const drawing = await trpcClient.drawings.get.query({ id: input.id });
        if (!drawing.analysis || drawing.ppmCandidates == null || drawing.ppm == null) await analyzeFx(input.id);
        stageChanged({ id: input.id, label: 'Reviewing blueprint evidence' });
        return await trpcClient.drawings.ask.mutate({ id: input.id, message: { id: input.message.id, question: input.message.question } });
    } finally {
        await refresh(input.id);
    }
});

sample({ clock: stageChanged, source: $stages, fn: (stages, { id, label }) => ({ ...stages, [id]: label }), target: $stages });
sample({ clock: uploadFx, fn: ({ id }) => ({ id, label: 'Uploading blueprint' }), target: stageChanged });
sample({ clock: inferFx, fn: (id) => ({ id, label: 'Detecting rooms and objects' }), target: stageChanged });
sample({ clock: askFx, source: $outgoing, fn: (outgoing, { id, message }) => ({ ...outgoing, [id]: message }), target: $outgoing });
sample({ clock: askFx.done, source: $outgoing, fn: (outgoing, { params }) => ({ ...outgoing, [params.id]: undefined }), target: $outgoing });
sample({ clock: askFx, source: $id, filter: (id, params) => id === params.id, fn: () => '', target: $draft });
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
sample({ clock: [opened, inferFx], fn: () => null, target: $inferenceError });
sample({ clock: opened, filter: (id): id is string => id !== null, target: analysisRequested });
sample({ clock: inferFx.fail, fn: ({ params, error }) => ({ id: params, message: error.message }), target: $inferenceError });
sample({ clock: analyzeFx, source: $analysisRunning, fn: (running, id) => ({ ...running, [id]: true }), target: $analysisRunning });
sample({ clock: analyzeFx.finally, source: $analysisRunning, fn: (running, { params }) => ({ ...running, [params]: false }), target: $analysisRunning });
sample({ clock: uploadFx.doneData, target: analysisRequested });
sample({ clock: analysisRequested, source: $analysisRunning, filter: (running, id) => !running[id], fn: (_, id) => id, target: analyzeFx });

export const $$drawings = {
    opened,
    renameFx,
    updateUploadFx,
    draftChanged,
    createFx,
    uploadFx,
    analyzeFx,
    inferFx,
    askFx,
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
