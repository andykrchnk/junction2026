import { createEffect, createEvent, createStore, sample } from 'effector';
import { debounce, readonly } from 'patronum';
import { TRPCClientError } from '@trpc/client';
import { CanvasStateZod, type CanvasState, type SaveCanvas } from '@repo/types';
import { trpcClient } from '@/shared/trpc';
import { writeLocal } from '../canvas-storage';

type SaveStatus = { type: 'saved' | 'dirty' | 'saving' } | { type: 'error'; message: string; conflict: boolean };

// Each mounted drawing owns its lifecycle; late requests cannot change another canvas.
export function createCanvasModel(id: string, storageKey: string) {
    const changed = createEvent<string>();
    const saveRequested = createEvent();
    const $document = createStore<string | null>(null);
    const $revision = createStore(0);
    const $status = createStore<SaveStatus>({ type: 'saved' });
    const loadFx = createEffect(async () => CanvasStateZod.parse(await trpcClient.drawings.getCanvas.query({ id })));
    const saveFx = createEffect(async (input: SaveCanvas) => CanvasStateZod.parse(await trpcClient.drawings.saveCanvas.mutate(input)));
    const retainRecoveryFx = createEffect((state: CanvasState) => writeLocal(`${storageKey}:recovery`, state));

    sample({ clock: loadFx.doneData, fn: (state) => state.document, target: $document });
    sample({ clock: loadFx.doneData, fn: (state) => state.revision, target: $revision });
    sample({ clock: changed, target: $document });
    sample({ clock: changed, source: $revision, fn: (revision, document) => ({ document, revision }), target: retainRecoveryFx });
    sample({
        clock: changed,
        source: $status,
        filter: (status) => status.type !== 'error' && status.type !== 'saving',
        fn: (): SaveStatus => ({ type: 'dirty' }),
        target: $status,
    });
    sample({ clock: debounce(changed, 1000), target: saveRequested });
    sample({
        clock: saveRequested,
        source: { document: $document, revision: $revision, status: $status, pending: saveFx.pending },
        filter: ({ document, status, pending }) => document !== null && status.type !== 'saved' && !(status.type === 'error' && status.conflict) && !pending,
        fn: ({ document, revision }) => ({ id, document: document ?? '', revision }),
        target: saveFx,
    });
    sample({ clock: saveFx, fn: (): SaveStatus => ({ type: 'saving' }), target: $status });
    sample({ clock: saveFx.doneData, fn: (state) => state.revision, target: $revision });
    sample({ clock: saveFx.doneData, source: $document, fn: (document, state) => ({ document, revision: state.revision }), target: retainRecoveryFx });
    sample({
        clock: saveFx.done,
        source: $document,
        fn: (document, { params }): SaveStatus => ({ type: document === params.document ? 'saved' : 'dirty' }),
        target: $status,
    });
    sample({ clock: saveFx.done, source: $document, filter: (document, { params }) => document !== params.document, target: saveRequested });
    sample({
        clock: saveFx.failData,
        fn: (error): SaveStatus => ({ type: 'error', message: error.message, conflict: error instanceof TRPCClientError && error.data?.code === 'CONFLICT' }),
        target: $status,
    });

    return { changed, saveRequested, loadFx, saveFx, $revision: readonly($revision), $status: readonly($status) };
}

export type CanvasModel = ReturnType<typeof createCanvasModel>;
export type LoadedCanvas = CanvasState;
