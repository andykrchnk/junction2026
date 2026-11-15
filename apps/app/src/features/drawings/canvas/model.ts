import { createEffect, createEvent, createStore, sample } from 'effector';
import { debounce, readonly } from 'patronum';
import { TRPCClientError } from '@trpc/client';
import { z } from 'zod';
import {
    CanvasStateZod,
    DrawingZod,
    DeleteEntityZod,
    type DeleteEntity,
    type UpdateEntityClass,
    type CanvasState,
    type SaveCanvas,
    type DetectedProperty,
    type CanvasVisibilityMode,
} from '@repo/types';
import { queryClient, trpc, trpcClient } from '@/shared/trpc';
import { readLocal, writeLocal } from '../canvas-storage';
import { $$drawings, type CanvasRegion } from '../model';

export type ObjectSelection = { page: number; index: number };

type SaveStatus = { type: 'saved' | 'dirty' | 'saving' } | { type: 'error'; message: string; conflict: boolean };
const VisibilityZod = z.object({ room: z.boolean(), icon: z.boolean(), junction: z.boolean() });

// Each mounted drawing owns its lifecycle; late requests cannot change another canvas.
export function createCanvasModel(id: string, storageKey: string) {
    const changed = createEvent<string>();
    const saveRequested = createEvent();
    const allObjectsShown = createEvent();
    const agentVisibilityApplied = createEvent<{
        requestId: string;
        mode: CanvasVisibilityMode;
        scopePages: number[];
        targets: ObjectSelection[];
        objects: (ObjectSelection & { type: DetectedProperty['type'] })[];
    }>();
    const agentVisibilityChanged = createEvent<{
        requestId: string;
        mode: CanvasVisibilityMode;
        hidden: string[];
        visibility: z.infer<typeof VisibilityZod>;
    }>();
    const agentSelectionCleared = createEvent();
    const agentSelectionApplied = createEvent<{ requestId: string; objects: ObjectSelection[] }>();
    const selected = createEvent<ObjectSelection | null>();
    const rangeSelected = createEvent<{ object: ObjectSelection; order: ObjectSelection[] }>();
    const selectionToggled = createEvent<ObjectSelection>();
    const groupSelected = createEvent<{ page: number; objects: ObjectSelection[] }>();
    const focusRequested = createEvent<ObjectSelection>();
    const regionFocusRequested = createEvent<CanvasRegion>();
    const objectVisibilityChanged = createEvent<{ object: ObjectSelection; visible: boolean }>();
    const visibilityChanged = createEvent<{ type: DetectedProperty['type']; visible: boolean }>();
    const $agentVisibility = createStore<{ requestId: string; mode: CanvasVisibilityMode } | null>(null);
    const $agentSelectionRequestId = createStore<string | null>(null);
    const $sheetFocus = createStore<{ page: number; sequence: number } | null>(null);
    const $anchor = createStore<ObjectSelection | null>(null);
    const $hiddenObjects = createStore<string[]>([]);
    const $selection = createStore<ObjectSelection[]>([]);
    const $focus = createStore<{ object: ObjectSelection; sequence: number } | null>(null);
    const $regionFocus = createStore<(CanvasRegion & { sequence: number }) | null>(null);
    const $document = createStore<string | null>(null);
    const $revision = createStore(0);
    const $status = createStore<SaveStatus>({ type: 'saved' });
    const $selected = createStore<ObjectSelection | null>(null);
    const $classResult = createStore<
        { type: 'idle' } | { type: 'saved'; blueprintId: string; entityId: string } | { type: 'error'; blueprintId: string; entityId: string; message: string }
    >({ type: 'idle' });
    const $deleteError = createStore<{ blueprintId: string; entityId: string; message: string } | null>(null);
    const savedVisibility = VisibilityZod.safeParse(readLocal(`${storageKey}:layers`));
    const $visibility = createStore(savedVisibility.success ? savedVisibility.data : { room: true, icon: true, junction: false });
    const loadFx = createEffect(async () => CanvasStateZod.parse(await trpcClient.drawings.getCanvas.query({ id })));
    const saveFx = createEffect(async (input: SaveCanvas) => CanvasStateZod.parse(await trpcClient.drawings.saveCanvas.mutate(input)));
    const retainRecoveryFx = createEffect((state: CanvasState) => writeLocal(`${storageKey}:recovery`, state));
    const retainVisibilityFx = createEffect((visibility: z.infer<typeof VisibilityZod>) => writeLocal(`${storageKey}:layers`, visibility));
    const updateEntityClassFx = createEffect(async (input: UpdateEntityClass) => {
        const drawing = DrawingZod.parse(await trpcClient.drawings.updateEntityClass.mutate(input));
        queryClient.setQueryData(trpc.drawings.get.queryKey({ id }), drawing);
        await Promise.all([
            queryClient.invalidateQueries(trpc.drawings.get.queryFilter({ id })),
            queryClient.invalidateQueries(trpc.drawings.list.queryFilter()),
        ]);
        return drawing;
    });

    const deleteEntityFx = createEffect(async ({ input }: { input: DeleteEntity; object: ObjectSelection }) => {
        const drawing = DrawingZod.parse(await trpcClient.drawings.deleteEntity.mutate(DeleteEntityZod.parse(input)));
        queryClient.setQueryData(trpc.drawings.get.queryKey({ id }), drawing);
        queryClient.setQueryData(
            trpc.drawings.comments.list.queryKey({ drawingId: id }),
            drawing.blueprints.flatMap((blueprint) => blueprint.comments).filter((comment) => !comment.deletedAt),
        );
        await Promise.all([
            queryClient.invalidateQueries(trpc.drawings.get.queryFilter({ id })),
            queryClient.invalidateQueries(trpc.drawings.list.queryFilter()),
            queryClient.invalidateQueries(trpc.drawings.comments.list.queryFilter({ drawingId: id })),
        ]);
        return drawing;
    });

    sample({ clock: [$selection, deleteEntityFx], fn: () => null, target: $deleteError });
    sample({
        clock: deleteEntityFx.fail,
        fn: ({ params, error }) => ({ blueprintId: params.input.blueprintId, entityId: params.input.entityId, message: error.message }),
        target: $deleteError,
    });
    sample({ clock: deleteEntityFx.done, fn: () => null, target: [selected, $focus, $anchor, $sheetFocus, $agentVisibility] });
    sample({
        clock: deleteEntityFx.done,
        source: $hiddenObjects,
        fn: (hidden, { params: { object } }) =>
            hidden.flatMap((key) => {
                const [page, index] = key.split(':').map(Number);
                if (page !== object.page || index < object.index) return [key];
                return index === object.index ? [] : [`${page}:${index - 1}`];
            }),
        target: $hiddenObjects,
    });

    sample({ clock: [$selection, updateEntityClassFx], fn: () => ({ type: 'idle' as const }), target: $classResult });
    sample({
        clock: updateEntityClassFx.done,
        fn: ({ params }) => ({ type: 'saved' as const, blueprintId: params.blueprintId, entityId: params.entityId }),
        target: $classResult,
    });
    sample({
        clock: updateEntityClassFx.fail,
        fn: ({ params, error }) => ({ type: 'error' as const, blueprintId: params.blueprintId, entityId: params.entityId, message: error.message }),
        target: $classResult,
    });

    sample({
        clock: agentVisibilityApplied,
        source: { visibility: $visibility, hidden: $hiddenObjects },
        fn: ({ visibility, hidden }, change) => {
            const nextVisibility = { ...visibility };
            const nextHidden = new Set(hidden);
            const key = (object: ObjectSelection) => `${object.page}:${object.index}`;
            const targets = new Set(change.targets.map(key));
            // Materialize disabled types before enabling them so unrelated objects stay hidden.
            if (change.mode !== 'hide') {
                const enabledTypes = new Set(
                    change.objects
                        .filter((object) => (change.mode === 'reset' ? change.scopePages.includes(object.page) : targets.has(key(object))))
                        .map((object) => object.type),
                );
                for (const object of change.objects) if (enabledTypes.has(object.type) && !visibility[object.type]) nextHidden.add(key(object));
                for (const type of enabledTypes) nextVisibility[type] = true;
            }
            for (const object of change.objects) {
                const objectKey = key(object);
                if (!change.scopePages.includes(object.page)) continue;
                if (change.mode === 'reset' || (change.mode !== 'hide' && targets.has(objectKey))) nextHidden.delete(objectKey);
                else if (change.mode === 'isolate' || (change.mode === 'hide' && targets.has(objectKey))) nextHidden.add(objectKey);
            }
            return { requestId: change.requestId, mode: change.mode, hidden: [...nextHidden], visibility: nextVisibility };
        },
        target: agentVisibilityChanged,
    });
    sample({ clock: agentVisibilityChanged, fn: ({ hidden }) => hidden, target: $hiddenObjects });
    sample({ clock: agentVisibilityChanged, fn: ({ visibility }) => visibility, target: $visibility });
    sample({ clock: agentVisibilityChanged, fn: ({ requestId, mode }) => ({ requestId, mode }), target: $agentVisibility });
    sample({
        clock: agentVisibilityChanged,
        source: $selection,
        fn: (selection, { hidden }) => selection.filter((object) => !hidden.includes(`${object.page}:${object.index}`)),
        target: $selection,
    });
    sample({ clock: allObjectsShown, fn: () => [], target: $hiddenObjects });
    sample({ clock: allObjectsShown, fn: () => ({ room: true, icon: true, junction: true }), target: $visibility });
    sample({ clock: [allObjectsShown, objectVisibilityChanged, visibilityChanged], fn: () => null, target: $agentVisibility });
    sample({ clock: agentSelectionApplied, fn: ({ requestId }) => requestId, target: $agentSelectionRequestId });
    sample({ clock: agentSelectionApplied, fn: ({ objects }) => objects, target: $selection });
    sample({ clock: agentSelectionApplied, fn: ({ objects }) => objects[0] ?? null, target: $anchor });
    sample({ clock: [agentSelectionApplied, agentSelectionCleared], fn: () => null, target: $regionFocus });
    sample({ clock: agentSelectionCleared, fn: () => null, target: selected });
    sample({ clock: [selected, rangeSelected, selectionToggled, groupSelected], fn: () => null, target: $agentSelectionRequestId });
    sample({ clock: agentSelectionCleared, fn: () => null, target: $agentSelectionRequestId });
    sample({ clock: groupSelected, fn: ({ objects }) => objects, target: $selection });
    sample({ clock: groupSelected, fn: ({ objects }) => objects[0] ?? null, target: $anchor });
    sample({ clock: groupSelected, source: $sheetFocus, fn: (focus, { page }) => ({ page, sequence: (focus?.sequence ?? 0) + 1 }), target: $sheetFocus });
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
        clock: regionFocusRequested,
        source: $regionFocus,
        fn: (focus, region) => ({ ...region, sequence: (focus?.sequence ?? 0) + 1 }),
        target: $regionFocus,
    });
    sample({ clock: regionFocusRequested, fn: () => [], target: $selection });
    sample({ clock: regionFocusRequested, fn: () => null, target: [$focus, $anchor, $sheetFocus] });
    sample({ clock: [selected, rangeSelected, selectionToggled, focusRequested, groupSelected], fn: () => null, target: $regionFocus });
    sample({
        clock: $$drawings.canvasRegionRequested,
        filter: (region) => region.id === id,
        fn: ({ page, bounds, label }) => ({ page, bounds, label }),
        target: regionFocusRequested,
    });
    sample({
        clock: $$drawings.canvasSelectionRequested,
        filter: (selection) => selection.id === id,
        fn: ({ page, index }) => ({ page, index }),
        target: [selected, focusRequested],
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
        allObjectsShown,
        agentVisibilityApplied,
        $agentVisibility: readonly($agentVisibility),
        agentSelectionCleared,
        agentSelectionApplied,
        $agentSelectionRequestId: readonly($agentSelectionRequestId),
        deleteEntityFx,
        $deleteError: readonly($deleteError),
        $deletingEntity: readonly(deleteEntityFx.pending),
        updateEntityClassFx,
        $classResult: readonly($classResult),
        $classPending: readonly(updateEntityClassFx.pending),
        groupSelected,
        $sheetFocus: readonly($sheetFocus),
        $regionFocus: readonly($regionFocus),
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
