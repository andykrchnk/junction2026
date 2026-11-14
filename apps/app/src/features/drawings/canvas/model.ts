import { createEffect, createEvent, createStore, sample } from 'effector';
import { debounce, readonly } from 'patronum';
import { TRPCClientError } from '@trpc/client';
import { z } from 'zod';
import { CanvasStateZod, type CanvasState, type SaveCanvas, type DetectedProperty } from '@repo/types';
import { trpcClient } from '@/shared/trpc';
import { readLocal, writeLocal } from '../canvas-storage';
import { $$drawings } from '../model';

export type ObjectSelection = { page: number; index: number };

type SaveStatus = { type: 'saved' | 'dirty' | 'saving' } | { type: 'error'; message: string; conflict: boolean };
const VisibilityZod = z.object({ room: z.boolean(), icon: z.boolean(), junction: z.boolean() });

// Each mounted drawing owns its lifecycle; late requests cannot change another canvas.
export function createCanvasModel(id: string, storageKey: string) {
    const changed = createEvent<string>();
    const saveRequested = createEvent();
    const selected = createEvent<ObjectSelection | null>();
    const rangeSelected = createEvent<{ object: ObjectSelection; order: ObjectSelection[] }>();
    const selectionToggled = createEvent<ObjectSelection>();
    const focusRequested = createEvent<ObjectSelection>();
    const objectVisibilityChanged = createEvent<{ object: ObjectSelection; visible: boolean }>();
    const visibilityChanged = createEvent<{ type: DetectedProperty['type']; visible: boolean }>();
    const $anchor = createStore<ObjectSelection | null>(null);
    const $hiddenObjects = createStore<string[]>([]);
    const $selection = createStore<ObjectSelection[]>([]);
    const $focus = createStore<{ object: ObjectSelection; sequence: number } | null>(null);
    const $document = createStore<string | null>(null);
    const $revision = createStore(0);
    const $status = createStore<SaveStatus>({ type: 'saved' });
    const $selected = createStore<ObjectSelection | null>(null);
    const savedVisibility = VisibilityZod.safeParse(readLocal(`${storageKey}:layers`));
    const $visibility = createStore(savedVisibility.success ? savedVisibility.data : { room: true, icon: true, junction: false });
    const loadFx = createEffect(async () => CanvasStateZod.parse(await trpcClient.drawings.getCanvas.query({ id })));
    const saveFx = createEffect(async (input: SaveCanvas) => CanvasStateZod.parse(await trpcClient.drawings.saveCanvas.mutate(input)));
    const retainRecoveryFx = createEffect((state: CanvasState) => writeLocal(`${storageKey}:recovery`, state));
    const retainVisibilityFx = createEffect((visibility: z.infer<typeof VisibilityZod>) => writeLocal(`${storageKey}:layers`, visibility));

    sample({
        clock: objectVisibilityChanged,
        source: $hiddenObjects,
        fn: (hidden, { object, visible }) => {
            const key = `${object.page}:${object.index}`;
            return visible ? hidden.filter((item) => item !== key) : [...new Set([...hidden, key])];
        },
        target: $hiddenObjects,
    });
    sample({
        clock: objectVisibilityChanged,
        source: $selection,
        filter: (_, change) => !change.visible,
        fn: (items, { object }) => items.filter((item) => item.page !== object.page || item.index !== object.index),
        target: $selection,
    });
    sample({ clock: loadFx.doneData, fn: (state) => state.document, target: $document });
    sample({ clock: selected, target: $anchor });
    sample({
        clock: rangeSelected,
        source: $anchor,
        fn: (anchor, { object, order }) => {
            const start = order.findIndex((item) => item.page === anchor?.page && item.index === anchor.index);
            const end = order.findIndex((item) => item.page === object.page && item.index === object.index);
            return start < 0 || end < 0 ? [object] : order.slice(Math.min(start, end), Math.max(start, end) + 1);
        },
        target: $selection,
    });
    sample({ clock: rangeSelected, source: $anchor, filter: (anchor) => anchor === null, fn: (_, { object }) => object, target: $anchor });
    sample({ clock: selected, fn: (object) => (object ? [object] : []), target: $selection });
    sample({
        clock: selectionToggled,
        source: $selection,
        fn: (items, object) =>
            items.some((item) => item.page === object.page && item.index === object.index)
                ? items.filter((item) => item.page !== object.page || item.index !== object.index)
                : [...items, object],
        target: $selection,
    });
    sample({ clock: $selection, fn: (items) => items.at(-1) ?? null, target: $selected });
    sample({ clock: focusRequested, source: $focus, fn: (focus, object) => ({ object, sequence: (focus?.sequence ?? 0) + 1 }), target: $focus });
    sample({
        clock: $$drawings.canvasSelectionRequested,
        filter: (selection) => selection.id === id,
        fn: ({ page, index }) => ({ page, index }),
        target: selected,
    });
    sample({
        clock: visibilityChanged,
        source: $visibility,
        fn: (visibility, change) => ({ ...visibility, [change.type]: change.visible }),
        target: $visibility,
    });
    sample({ clock: visibilityChanged, filter: (change) => !change.visible, fn: () => null, target: selected });
    sample({ clock: $visibility, target: retainVisibilityFx });
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

    return {
        objectVisibilityChanged,
        $hiddenObjects: readonly($hiddenObjects),
        rangeSelected,
        selectionToggled,
        focusRequested,
        $selection: readonly($selection),
        $focus: readonly($focus),
        changed,
        saveRequested,
        selected,
        visibilityChanged,
        loadFx,
        saveFx,
        $selected: readonly($selected),
        $visibility: readonly($visibility),
        $revision: readonly($revision),
        $status: readonly($status),
    };
}

export type CanvasModel = ReturnType<typeof createCanvasModel>;
export type LoadedCanvas = CanvasState;
