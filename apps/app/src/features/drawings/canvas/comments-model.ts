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
    type DetectedProperty,
} from '@repo/types';
import { queryClient, trpc, trpcClient } from '@/shared/trpc';
import { $$drawings } from '../model';
import { layoutPages } from '../layout';

type DraftComment = Omit<CommentCreate, 'drawingId'>;
export type AnnotationPreview = { page: number; index: number; property: DetectedProperty; text: string };

type CommentPoint = Pick<DraftComment, 'page' | 'x' | 'y'>;

export function createCommentsModel(drawingId: string) {
    const modeChanged = createEvent<'default' | 'comment' | 'annotate'>();
    const annotationSent = createEvent<AnnotationPreview>();
    const annotationTextChanged = createEvent<string>();
    const $annotationText = createStore('');
    const $annotationError = createStore<string | null>(null);
    const focusRequested = createEvent<string>();
    const openChanged = createEvent<string | null>();
    const pointRequested = createEvent<CommentPoint>();
    const draftChanged = createEvent<string>();
    const draftCancelled = createEvent();
    const saveRequested = createEvent();
    const deleteRequested = createEvent<string>();
    const deletionRouted = createEvent<{ id: string; kind: 'draft' | 'persisted' }>();
    const $focusRequest = createStore<{ id: string } | null>(null);
    const $mode = createStore<'default' | 'comment' | 'annotate'>('default');
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

    const sendAnnotationFx = createEffect(async (selection: AnnotationPreview) => {
        const drawing = await trpcClient.drawings.get.query({ id: drawingId });
        if (drawing.busy || drawing.messages.some((message) => !message.answer)) throw new Error('Wait for the current response before sending an annotation.');
        const blueprint = drawing.blueprints.find((blueprint) => blueprint.pageNumber === selection.page && !blueprint.attachment.hiddenFromCanvas);
        const page = blueprint ? layoutPages([blueprint])[0] : null;
        const property = page?.detectedProperties[selection.index];
        if (!blueprint || !page || !property || JSON.stringify(property) !== JSON.stringify(selection.property)) {
            throw new Error('This selection has changed. Select the element again before sending.');
        }
        const points =
            property.geometry.type === 'Point'
                ? [property.geometry.coordinates]
                : property.geometry.type === 'Polygon'
                  ? property.geometry.coordinates.flat()
                  : property.geometry.coordinates.flat(2);
        if (!points.length || points.some((point) => point.some((value) => !Number.isFinite(value)))) {
            throw new Error('This element has no valid location. Select another element.');
        }
        const bounds = [
            Math.min(...points.map(([x]) => x)),
            Math.min(...points.map(([, y]) => y)),
            Math.max(...points.map(([x]) => x)),
            Math.max(...points.map(([, y]) => y)),
        ].map((value) => Math.round(value));
        const context = JSON.stringify({
            blueprintId: blueprint.id,
            entityId: property.id,
            sheet: selection.page,
            element: selection.index + 1,
            label: property.label,
            type: property.type,
            boundsPx: bounds,
            rasterWidth: page.width,
            rasterHeight: page.height,
        });
        const question = `${selection.text.trim()}\n\nSelected blueprint element (user-selected context, not verified measurements):\n${context}`;
        if (question.length > 4000) throw new Error('Shorten your annotation to leave room for the selected element context.');
        await $$drawings.askFx({ id: drawingId, message: { id: crypto.randomUUID(), question, answer: null } });
    });

    sample({ clock: annotationTextChanged, target: $annotationText });
    sample({
        clock: annotationSent,
        source: { sending: sendAnnotationFx.pending, asking: $$drawings.$asking },
        filter: ({ sending, asking }, selection) => !sending && !asking && !!selection.text.trim(),
        fn: (_, selection) => selection,
        target: sendAnnotationFx,
    });
    sample({ clock: sendAnnotationFx, fn: () => null, target: $annotationError });
    sample({ clock: sendAnnotationFx.failData, fn: (error) => error.message, target: $annotationError });
    sample({ clock: sendAnnotationFx.done, fn: () => '', target: $annotationText });
    sample({ clock: sendAnnotationFx.done, fn: () => 'default' as const, target: $mode });
    sample({ clock: focusRequested, fn: (id) => ({ id }), target: $focusRequest });
    sample({ clock: focusRequested, target: $openId });
    sample({ clock: modeChanged, target: $mode });
    sample({ clock: modeChanged, filter: (mode) => mode === 'default', fn: () => null, target: $openId });
    sample({ clock: openChanged, target: $openId });
    sample({ clock: draftCancelled, fn: () => null, target: [$draft, $openId, $error] });
    sample({
        clock: openChanged,
        source: $draft,
        filter: (draft, id) => id === null && !!draft && !draft.text.trim(),
        fn: () => null,
        target: $draft,
    });
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
        annotationSent,
        annotationTextChanged,
        $annotationText: readonly($annotationText),
        $annotationError: readonly($annotationError),
        $annotationSending: readonly(sendAnnotationFx.pending),
        focusRequested,
        $focusRequest: readonly($focusRequest),
        modeChanged,
        openChanged,
        pointRequested,
        draftChanged,
        draftCancelled,
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
