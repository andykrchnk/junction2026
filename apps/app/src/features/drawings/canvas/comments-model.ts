import { combine, createEffect, createEvent, createStore, sample } from 'effector';
import { readonly } from 'patronum';
import {
    CommentCreateZod,
    CommentDeleteZod,
    CommentDeleteResultZod,
    ScanCommentZod,
    type CommentCreate,
    type CommentTarget,
    type CommentDelete,
    type ScanComments,
    type DetectedProperty,
} from '@repo/types';
import { queryClient, trpc, trpcClient } from '@/shared/trpc';
import { $$drawings } from '../model';
import { layoutPages } from '../layout';
import { hasAgentMention, removeAgentMention } from '../agent-mention';
import { annotationContextSchema, annotationMarker } from '../annotation-context';

type DraftComment = Pick<CommentCreate, 'id' | 'page' | 'text'> & CommentTarget;
export type AnnotationPreview = { page: number; index: number; property: DetectedProperty; text: string };

type CommentPlacement = Pick<CommentCreate, 'page'> & CommentTarget;
type PointAnnotationPreview = { page: number; point: { x: number; y: number }; text: string };
type AnnotationRequest = (AnnotationPreview | PointAnnotationPreview) & { messageId?: string };

export function createCommentsModel(drawingId: string) {
    const modeChanged = createEvent<'default' | 'comment' | 'annotate'>();
    const annotationSent = createEvent<AnnotationPreview>();
    const annotationDispatched = createEvent<{ messageId: string }>();
    const annotationRetryRequested = createEvent<string>();
    const draftSendFailed = createEvent<{ draft: DraftComment; error: string; restore: boolean }>();
    const annotationTextChanged = createEvent<string>();
    const $annotationText = createStore('');
    const $annotationError = createStore<string | null>(null);
    const focusRequested = createEvent<string>();
    const openChanged = createEvent<string | null>();
    const placementRequested = createEvent<CommentPlacement>();
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

    const sendAnnotationFx = createEffect(async (selection: AnnotationRequest) => {
        const drawing = await trpcClient.drawings.get.query({ id: drawingId });
        if (drawing.busy || drawing.messages.some((message) => !message.answer)) throw new Error('Wait for the current response before sending an annotation.');
        const blueprint = drawing.blueprints.find((blueprint) => blueprint.pageNumber === selection.page && !blueprint.attachment.hiddenFromCanvas);
        const page = blueprint ? layoutPages([blueprint])[0] : null;
        if (!blueprint || !page) throw new Error('This blueprint is not ready. Reopen it before sending.');
        const property = 'property' in selection ? page.detectedProperties[selection.index] : null;
        if ('property' in selection && (!property || JSON.stringify(property) !== JSON.stringify(selection.property))) {
            throw new Error('This selection has changed. Select the element again before sending.');
        }
        const points = property
            ? property.geometry.type === 'Point'
                ? [property.geometry.coordinates]
                : property.geometry.type === 'Polygon'
                  ? property.geometry.coordinates.flat()
                  : property.geometry.coordinates.flat(2)
            : 'point' in selection &&
                [selection.point.x, selection.point.y].every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)
              ? [[selection.point.x * page.width, selection.point.y * page.height]]
              : [];
        if (!points.length || points.some((point) => point.some((value) => !Number.isFinite(value)))) {
            throw new Error('This selection has no valid location. Select another location.');
        }
        const bounds = [
            Math.min(...points.map(([x]) => x)),
            Math.min(...points.map(([, y]) => y)),
            Math.max(...points.map(([x]) => x)),
            Math.max(...points.map(([, y]) => y)),
        ].map((value) => Math.round(value));
        const context = annotationContextSchema.parse({
            blueprintId: blueprint.id,
            entityId: property?.id ?? null,
            sheet: selection.page,
            element: 'index' in selection ? selection.index + 1 : null,
            label: property?.label ?? 'Point',
            type: property?.type ?? 'point',
            boundsPx: bounds,
            rasterWidth: page.width,
            rasterHeight: page.height,
        });
        const question = `${selection.text.trim()}${annotationMarker}${JSON.stringify(context)}`;
        if (question.length > 4000) throw new Error('Shorten your question to leave room for the selected location context.');
        const messageId = selection.messageId ?? crypto.randomUUID();
        const response = $$drawings.askFx({ id: drawingId, message: { id: messageId, question, answer: null } });
        annotationDispatched({ messageId });
        await response;
    });
    const sendDraftFx = createEffect(async (draft: DraftComment) => {
        const text = removeAgentMention(draft.text);
        if (!text) throw new Error('Write a question for the agent.');
        if (draft.application === 'point') {
            await sendAnnotationFx({ page: draft.page, point: { x: draft.x, y: draft.y }, text, messageId: draft.id });
            return;
        }
        const drawing = await trpcClient.drawings.get.query({ id: drawingId });
        const blueprint = drawing.blueprints.find((item) => item.pageNumber === draft.page && !item.attachment.hiddenFromCanvas);
        const page = blueprint ? layoutPages([blueprint])[0] : null;
        const index = page?.detectedProperties.findIndex((property) =>
            draft.roomId !== null ? property.type === 'room' && property.id === draft.roomId : property.type === 'icon' && property.id === draft.fixtureId,
        );
        const property = index !== undefined && index >= 0 ? page?.detectedProperties[index] : null;
        if (!property || index === undefined || index < 0) throw new Error('This object is no longer available. Select it again before sending.');
        await sendAnnotationFx({ page: draft.page, index, property, text, messageId: draft.id });
    });
    const $creating = combine(createFx.pending, sendDraftFx.pending, (creating, sending) => creating || sending);
    const $annotationSending = combine(sendAnnotationFx.pending, sendDraftFx.pending, (sending, sendingDraft) => sending || sendingDraft);

    sample({ clock: annotationTextChanged, target: $annotationText });
    sample({
        clock: annotationSent,
        source: { sending: $annotationSending, asking: $$drawings.$asking },
        filter: ({ sending, asking }, selection) => !sending && !asking && !!selection.text.trim(),
        fn: (_, selection) => selection,
        target: sendAnnotationFx,
    });
    sample({ clock: sendAnnotationFx, fn: () => null, target: $annotationError });
    sample({ clock: sendAnnotationFx.failData, fn: (error) => error.message, target: $annotationError });
    sample({ clock: annotationDispatched, fn: () => '', target: $annotationText });
    sample({ clock: annotationDispatched, fn: () => 'default' as const, target: $mode });
    sample({ clock: annotationDispatched, source: $draft, filter: (draft, { messageId }) => draft?.id === messageId, fn: () => null, target: $draft });
    sample({ clock: annotationDispatched, source: $openId, filter: (openId, { messageId }) => openId === messageId, fn: () => null, target: $openId });
    sample({
        clock: sendAnnotationFx.fail,
        source: { draft: $draft, mode: $mode, text: $annotationText },
        filter: ({ draft, mode, text }, { params }) => params.messageId === undefined && draft === null && mode === 'default' && !text,
        fn: (_, { params }) => params.text,
        target: annotationRetryRequested,
    });
    sample({ clock: annotationRetryRequested, target: $annotationText });
    sample({ clock: annotationRetryRequested, fn: () => 'annotate' as const, target: $mode });
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
        clock: placementRequested,
        source: { draft: $draft, mode: $mode, creating: $creating },
        filter: ({ mode, creating }) => mode === 'comment' && !creating,
        fn: ({ draft }, placement): DraftComment => ({ id: draft?.id ?? crypto.randomUUID(), text: draft?.text ?? '', ...placement }),
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
        source: { draft: $draft, creating: $creating, deleting: deleteFx.pending },
        filter: ({ draft, creating, deleting }) => !creating && !deleting && Boolean(draft?.text.trim()) && !hasAgentMention(draft?.text ?? ''),
        fn: ({ draft }) => CommentCreateZod.parse({ drawingId, ...draft, text: draft?.text.trim() }),
        target: createFx,
    });
    sample({
        clock: saveRequested,
        source: { draft: $draft, creating: $creating, deleting: deleteFx.pending },
        filter: ({ draft, creating, deleting }) => !creating && !deleting && draft !== null && hasAgentMention(draft.text),
        fn: ({ draft }) => {
            if (!draft) throw new Error('Select a comment location first.');
            return draft;
        },
        target: sendDraftFx,
    });
    sample({ clock: sendDraftFx, fn: () => null, target: $error });
    sample({
        clock: sendDraftFx.fail,
        source: $draft,
        filter: (draft, { params }) => draft === null || draft.id === params.id,
        fn: (draft, { params, error }) => ({ draft: params, error: error.message, restore: draft === null }),
        target: draftSendFailed,
    });
    sample({ clock: draftSendFailed, fn: ({ error }) => error, target: $error });
    sample({ clock: draftSendFailed, filter: ({ restore }) => restore, fn: ({ draft }) => draft, target: $draft });
    sample({ clock: draftSendFailed, filter: ({ restore }) => restore, fn: () => 'comment' as const, target: $mode });
    sample({ clock: createFx, fn: () => null, target: $error });
    sample({ clock: placementRequested, fn: () => null, target: $error });
    sample({ clock: draftChanged, fn: () => null, target: $error });
    sample({ clock: createFx.failData, fn: (error) => error.message, target: $error });
    sample({ clock: createFx.done, source: $draft, filter: (draft, { params }) => draft?.id === params.id, fn: () => null, target: $draft });
    sample({
        clock: deleteRequested,
        source: { draft: $draft, creating: $creating, deleting: deleteFx.pending },
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
        $annotationSending: readonly($annotationSending),
        focusRequested,
        $focusRequest: readonly($focusRequest),
        modeChanged,
        openChanged,
        placementRequested,
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
        $creating: readonly($creating),
        $deleting: readonly(deleteFx.pending),
        $deleteError: readonly($deleteError),
    };
}

export type CommentsModel = ReturnType<typeof createCommentsModel>;
