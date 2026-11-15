import { createEffect, createEvent, createStore, sample } from 'effector';
import { readonly } from 'patronum';
import { z } from 'zod';
import { queryClient, trpc, trpcClient } from '@/shared/trpc';

export type PpmAdjustmentTarget = Readonly<{
    blueprintId: string;
    entityId: string;
    layoutRevision: string;
    label: string;
    areaPixels: number;
    currentAreaSquareMetres: number | null;
}>;

const AreaSquareMetresZod = z.coerce.number().finite().positive();

export function createPpmAdjustmentModel(drawingId: string) {
    const targetOpened = createEvent<PpmAdjustmentTarget>();
    const targetAccepted = createEvent<PpmAdjustmentTarget>();
    const dismissed = createEvent();
    const cancelled = createEvent();
    const areaChanged = createEvent<string>();
    const saveRequested = createEvent();
    const $target = createStore<PpmAdjustmentTarget | null>(null);
    const $draft = createStore('');
    const $error = createStore<string | null>(null);
    const saveFx = createEffect(async ({ target, draft }: { target: PpmAdjustmentTarget | null; draft: string }) => {
        if (!target) throw new Error('Select an object to adjust its area.');
        const area = AreaSquareMetresZod.safeParse(draft.trim());
        if (!area.success) throw new Error('Enter an area greater than zero in square metres.');
        const drawing = await trpcClient.drawings.adjustPpm.mutate({
            id: drawingId,
            blueprintId: target.blueprintId,
            entityId: target.entityId,
            layoutRevision: target.layoutRevision,
            areaSquareMetres: area.data,
        });
        queryClient.setQueryData(trpc.drawings.get.queryKey({ id: drawingId }), drawing);
        await Promise.all([
            queryClient.invalidateQueries(trpc.drawings.list.queryFilter()),
            queryClient.invalidateQueries(trpc.drawings.get.queryFilter({ id: drawingId })),
        ]);
        return drawing;
    });

    sample({ clock: targetOpened, source: saveFx.pending, filter: (saving) => !saving, fn: (_, target) => target, target: targetAccepted });
    sample({ clock: dismissed, source: saveFx.pending, filter: (saving) => !saving, target: cancelled });
    sample({ clock: targetAccepted, target: $target });
    sample({ clock: targetAccepted, fn: (target) => target.currentAreaSquareMetres?.toString() ?? '', target: $draft });
    sample({ clock: areaChanged, target: $draft });
    sample({ clock: [targetAccepted, areaChanged, cancelled, saveFx], fn: () => null, target: $error });
    sample({ clock: [cancelled, saveFx.done], fn: () => null, target: $target });
    sample({ clock: [cancelled, saveFx.done], fn: () => '', target: $draft });
    sample({ clock: saveFx.failData, fn: (error) => error.message, target: $error });
    sample({
        clock: saveRequested,
        source: { target: $target, draft: $draft, saving: saveFx.pending },
        filter: ({ target, saving }) => target !== null && !saving,
        fn: ({ target, draft }) => ({ target, draft }),
        target: saveFx,
    });

    return {
        targetOpened,
        dismissed,
        areaChanged,
        saveRequested,
        $target: readonly($target),
        $draft: readonly($draft),
        $error: readonly($error),
        $saving: readonly(saveFx.pending),
    };
}

export type PpmAdjustmentModel = ReturnType<typeof createPpmAdjustmentModel>;
