import { createEffect, createEvent, createStore, sample } from 'effector';
import { readonly } from 'patronum';
import {
    CommentCreateZod,
    CommentDeleteZod,
    CommentDeleteResultZod,
    ScanCommentZod,
    type CommentCreate,
    type CommentDelete,
    type ScanComments,
} from '@repo/types';
import { queryClient, trpc, trpcClient } from '@/shared/trpc';

type DraftComment = Omit<CommentCreate, 'drawingId'>;
type CommentPoint = Pick<DraftComment, 'page' | 'x' | 'y'>;

export function createCommentsModel(drawingId: string) {
    const modeChanged = createEvent<'default' | 'comment'>();
    const openChanged = createEvent<string | null>();
    const pointRequested = createEvent<CommentPoint>();
    const draftChanged = createEvent<string>();
    const saveRequested = createEvent();
    const deleteRequested = createEvent<string>();
    const deletionRouted = createEvent<{ id: string; kind: 'draft' | 'persisted' }>();
    const $mode = createStore<'default' | 'comment'>('default');
    const $openId = createStore<string | null>(null);
    const $draft = createStore<DraftComment | null>(null);
    const $error = createStore<string | null>(null);
    const $deleteError = createStore<{ id: string; message: string } | null>(null);
    const createFx = createEffect(async (input: CommentCreate) => {
        const comment = ScanCommentZod.parse(await trpcClient.drawings.comments.create.mutate(CommentCreateZod.parse(input)));
        queryClient.setQueryData<ScanComments>(trpc.drawings.comments.list.queryKey({ drawingId }), (comments) => [
            ...(comments ?? []).filter((existing) => existing.id !== comment.id && !existing.deletedAt),
            comment,
        ]);
        await Promise.all([
            queryClient.invalidateQueries(trpc.drawings.comments.list.queryFilter({ drawingId })),
            queryClient.invalidateQueries(trpc.drawings.get.queryFilter({ id: drawingId })),
        ]);
        return comment;
    });
    const deleteFx = createEffect(async (input: CommentDelete) => {
        const result = CommentDeleteResultZod.parse(await trpcClient.drawings.comments.delete.mutate(CommentDeleteZod.parse(input)));
        if (result.id !== input.id) throw new Error('The comment could not be deleted. Please retry.');
        queryClient.setQueryData<ScanComments>(trpc.drawings.comments.list.queryKey({ drawingId }), (comments) =>
            (comments ?? []).filter((comment) => comment.id !== result.id && !comment.deletedAt),
        );
        await Promise.all([
            queryClient.invalidateQueries(trpc.drawings.comments.list.queryFilter({ drawingId })),
            queryClient.invalidateQueries(trpc.drawings.get.queryFilter({ id: drawingId })),
        ]);
        return result;
    });

    sample({ clock: modeChanged, target: $mode });
    sample({ clock: modeChanged, filter: (mode) => mode === 'default', fn: () => null, target: $openId });
    sample({ clock: openChanged, target: $openId });
    sample({
        clock: pointRequested,
        source: { draft: $draft, mode: $mode, creating: createFx.pending },
        filter: ({ mode, creating }) => mode === 'comment' && !creating,
        fn: ({ draft }, point): DraftComment => ({ id: draft?.id ?? crypto.randomUUID(), text: draft?.text ?? '', ...point }),
        target: $draft,
    });
    sample({ clock: $draft, filter: (draft) => draft !== null, fn: (draft) => draft?.id ?? null, target: $openId });
    sample({
        clock: draftChanged,
        source: $draft,
        filter: (draft) => draft !== null,
        fn: (draft, text) => draft && { ...draft, text: text.slice(0, 6000) },
        target: $draft,
    });
    sample({
        clock: saveRequested,
        source: { draft: $draft, creating: createFx.pending, deleting: deleteFx.pending },
        filter: ({ draft, creating, deleting }) => !creating && !deleting && Boolean(draft?.text.trim()),
        fn: ({ draft }) => CommentCreateZod.parse({ drawingId, ...draft, text: draft?.text.trim() }),
        target: createFx,
    });
    sample({ clock: createFx, fn: () => null, target: $error });
    sample({ clock: pointRequested, fn: () => null, target: $error });
    sample({ clock: createFx.failData, fn: (error) => error.message, target: $error });
    sample({ clock: createFx.done, source: $draft, filter: (draft, { params }) => draft?.id === params.id, fn: () => null, target: $draft });
    sample({
        clock: deleteRequested,
        source: { draft: $draft, creating: createFx.pending, deleting: deleteFx.pending },
        filter: ({ creating, deleting }) => !creating && !deleting,
        fn: ({ draft }, id): { id: string; kind: 'draft' | 'persisted' } => ({ id, kind: draft?.id === id ? 'draft' : 'persisted' }),
        target: deletionRouted,
    });
    sample({ clock: deletionRouted, filter: ({ kind }) => kind === 'draft', fn: () => null, target: $draft });
    sample({
        clock: deletionRouted,
        source: $openId,
        filter: (openId, action) => action.kind === 'draft' && openId === action.id,
        fn: () => null,
        target: $openId,
    });
    sample({ clock: deletionRouted, filter: ({ kind }) => kind === 'persisted', fn: ({ id }) => ({ drawingId, id }), target: deleteFx });
    sample({ clock: deletionRouted, fn: () => null, target: $deleteError });
    sample({ clock: deleteFx.fail, fn: ({ params, error }) => ({ id: params.id, message: error.message }), target: $deleteError });
    sample({ clock: deleteFx.done, source: $openId, filter: (openId, { params }) => openId === params.id, fn: () => null, target: $openId });

    return {
        modeChanged,
        openChanged,
        pointRequested,
        draftChanged,
        saveRequested,
        createFx,
        deleteRequested,
        deleteFx,
        $mode: readonly($mode),
        $openId: readonly($openId),
        $draft: readonly($draft),
        $error: readonly($error),
        $creating: readonly(createFx.pending),
        $deleting: readonly(deleteFx.pending),
        $deleteError: readonly($deleteError),
    };
}

export type CommentsModel = ReturnType<typeof createCommentsModel>;
