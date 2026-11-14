import { layoutPages } from './layout';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUnit } from 'effector-react';
import { AnimatePresence, MotionConfig } from 'motion/react';
import type { Drawing } from '@repo/types';
import { AskUserQuestions } from '@repo/design-system/components/ui/ask-user-questions';
import { Button } from '@repo/design-system/components/ui/button';
import { InputMessage } from '@repo/design-system/components/ui/input-message';
import { ChatMessage } from '@repo/design-system/components/ui/chat-message';
import { trpc } from '@/shared/trpc';
import { $$drawings } from './model';
import { DrawingActivity } from './drawing-activity';
import { DrawingProgress } from './drawing-progress';

const questionLimit = 4000;

export function DrawingChat({ id, previewDrawing }: Readonly<{ id: string; previewDrawing?: Drawing }>) {
    const { draft, error, activity, asking, outgoing, stages } = useUnit({
        outgoing: $$drawings.$outgoing,
        stages: $$drawings.$stages,
        draft: $$drawings.$draft,
        error: $$drawings.$error,
        activity: $$drawings.$activity,
        asking: $$drawings.$asking,
    });
    const {
        data: drawing,
        isPending,
        error: loadError,
    } = useQuery({
        ...trpc.drawings.get.queryOptions({ id }),
        enabled: !previewDrawing,
        initialData: previewDrawing,
        refetchInterval: (query) =>
            query.state.data?.busy || query.state.data?.blueprints.some((blueprint) => blueprint.status.type === 'processing') || (activity[id] ?? 0) > 0
                ? 2000
                : false,
    });
    const endRef = useRef<HTMLDivElement>(null);
    const submissionsRef = useRef(new Set<string>());
    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'nearest' });
    }, [drawing?.messages.length, drawing?.messages.at(-1)?.answer, drawing?.blueprints, outgoing[id]]);
    if (isPending)
        return (
            <p role="status" className="p-4 text-sm text-muted-foreground">
                Loading…
            </p>
        );
    if (!drawing)
        return (
            <p role="alert" className="p-4 text-sm text-destructive">
                {loadError?.message ?? 'Drawing not found.'}
            </p>
        );

    const busy = drawing.busy || (activity[id] ?? 0) > 0;
    const optimistic = outgoing[id];
    const messages = optimistic && !drawing.messages.some((message) => message.id === optimistic.id) ? [...drawing.messages, optimistic] : drawing.messages;
    const pending = messages.find((message) => !message.answer);
    const latestMessage = messages.at(-1);
    const answer = latestMessage?.answer;
    const clarification = !pending && answer?.status === 'needs_clarification' ? answer.clarificationQuestion : null;
    const clarificationId = latestMessage?.id ?? 'clarification';
    const visibleError = error?.id === id ? error.message : drawing.error;
    const ask = (message: Drawing['messages'][number]) => {
        if (!drawing.blueprints.length || busy || asking || submissionsRef.current.has(id)) return;
        submissionsRef.current.add(id);
        void $$drawings
            .askFx({ id, message })
            .catch(() => {})
            .finally(() => submissionsRef.current.delete(id));
    };
    const send = (value: string) => {
        const question = value.trim();
        if (!question || question.length > questionLimit || pending) return;
        ask({ id: crypto.randomUUID(), question, answer: null });
    };

    return (
        <MotionConfig reducedMotion="user">
            <section aria-label="Drawing chat" className="flex h-full min-h-0 flex-col">
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div role="log" aria-label="Conversation" className="min-h-0 flex-1 overflow-y-auto p-4">
                        <div className="flex min-h-full flex-col justify-end gap-5">
                            <DrawingProgress
                                drawing={drawing}
                                busy={busy}
                                stage={stages[id]}
                                onRetry={
                                    previewDrawing
                                        ? undefined
                                        : () => {
                                              void $$drawings.analyzeFx(id).catch(() => {});
                                          }
                                }
                            />
                            {drawing.blueprints.some((blueprint) => blueprint.layout?.summary) && (
                                <ChatMessage from="assistant" className="w-full max-w-full">
                                    {drawing.blueprints
                                        .map((blueprint) => blueprint.layout?.summary)
                                        .filter(Boolean)
                                        .join('\n')}
                                </ChatMessage>
                            )}
                            <AnimatePresence initial={false}>
                                {messages.flatMap((message) => [
                                    <ChatMessage key={`${message.id}-user`} from="user">
                                        {message.question}
                                    </ChatMessage>,
                                    message.answer ? (
                                        <ChatMessage key={`${message.id}-assistant`} from="assistant" className="w-full max-w-full">
                                            {message.answer.status === 'cannot_determine' && (
                                                <p className="text-muted-foreground mb-2 text-xs font-medium">Cannot determine from available information</p>
                                            )}
                                            {message.answer.text}
                                            {!!message.answer.references?.length && (
                                                <div className="mt-3 flex flex-wrap gap-2" aria-label="Supporting drawing objects">
                                                    {message.answer.references.map((reference, index) => {
                                                        const blueprint = drawing.blueprints.find((item) => item.id === reference.blueprintId);
                                                        const page = layoutPages(drawing.blueprints).find((item) => item.page === blueprint?.pageNumber);
                                                        const propertyIndex =
                                                            page?.detectedProperties.findIndex((item) => item.id === reference.entityId) ?? -1;
                                                        if (!blueprint) return null;
                                                        if (!page || propertyIndex < 0)
                                                            return (
                                                                <span key={index} className="text-xs text-muted-foreground">
                                                                    Sheet {blueprint.pageNumber}
                                                                </span>
                                                            );
                                                        return (
                                                            <Button
                                                                key={index}
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() =>
                                                                    $$drawings.canvasSelectionRequested({ id, page: page.page, index: propertyIndex })
                                                                }
                                                            >
                                                                Sheet {blueprint.pageNumber} · {page.detectedProperties[propertyIndex].label}
                                                            </Button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            {message.answer.status === 'needs_clarification' &&
                                                message.answer.clarificationQuestion &&
                                                message.id !== (clarification ? latestMessage?.id : null) && (
                                                    <div className="mt-3 border-t pt-3">
                                                        <p className="text-primary text-xs font-medium">More information needed</p>
                                                        <p className="mt-1">{message.answer.clarificationQuestion}</p>
                                                    </div>
                                                )}
                                            {!!message.answer.userProvidedInformation?.length && (
                                                <details className="mt-3 text-xs">
                                                    <summary className="cursor-pointer text-muted-foreground">Information you provided</summary>
                                                    <ul className="mt-2 list-disc space-y-1 pl-5">
                                                        {message.answer.userProvidedInformation.map((information, index) => (
                                                            <li key={index}>{information}</li>
                                                        ))}
                                                    </ul>
                                                </details>
                                            )}
                                        </ChatMessage>
                                    ) : null,
                                ])}
                            </AnimatePresence>
                            {busy && drawing.blueprints.length > 0 && <DrawingActivity label={stages[id] ?? 'Reviewing your question'} />}
                            {visibleError && (
                                <p role="alert" className="text-sm text-destructive">
                                    {visibleError}
                                </p>
                            )}
                            {pending && !busy && (
                                <Button variant="ghost" className="self-start" onClick={() => ask(pending)}>
                                    Retry
                                </Button>
                            )}
                            <div ref={endRef} />
                        </div>
                    </div>
                    <div className="max-h-[50%] shrink-0 overflow-y-auto p-3">
                        {clarification ? (
                            <fieldset disabled={busy || asking} className="min-w-0 border-0 p-0">
                                <legend className="text-primary mb-2 text-xs font-medium">More information needed</legend>
                                <AskUserQuestions
                                    key={clarificationId}
                                    className="chat-clarification-input bg-[var(--chat-input-background)]"
                                    aria-label="Reply to the clarification"
                                    questions={[
                                        {
                                            id: clarificationId,
                                            title: clarification,
                                            freeText: true,
                                            freeTextPlaceholder: 'Type your reply…',
                                            freeTextValidate: (value) => (value.length > questionLimit ? 'Use up to 4,000 characters.' : null),
                                            skippable: false,
                                            nextLabel: 'Send reply',
                                        },
                                    ]}
                                    currentIndex={0}
                                    answers={{ [clarificationId]: { questionId: clarificationId, selectedIds: [], otherText: draft } }}
                                    onAnswersChange={(answers) => $$drawings.draftChanged((answers[clarificationId]?.otherText ?? '').slice(0, questionLimit))}
                                    onComplete={(answers) => send(answers[clarificationId]?.otherText ?? '')}
                                />
                            </fieldset>
                        ) : (
                            <InputMessage
                                value={draft}
                                onValueChange={$$drawings.draftChanged}
                                onSend={(question, files) => {
                                    if (files.length === 0) send(question);
                                }}
                                status="idle"
                                showQueue={false}
                                placeholder="Message…"
                                sendLabel="Send message"
                                minRows={1}
                                maxRows={6}
                                disabled={!drawing.blueprints.length || busy || !!pending || asking}
                                textareaProps={{ 'aria-label': 'Message', maxLength: questionLimit, autoComplete: 'off' }}
                            />
                        )}
                    </div>
                </div>
            </section>
        </MotionConfig>
    );
}
