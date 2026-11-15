import { AnnotationChatNavigation } from './drawing-annotation';
import { MessageSquare } from '@repo/design-system/lib/icons-remix';
import { DrawingComments } from './drawing-comments';
import type { CommentsModel } from './canvas/comments-model';
import { useEffect, useRef, useState } from 'react';
import { Tabs, TabsItem } from '@repo/design-system/components/ui/tabs';
import { remixIcons } from '@repo/design-system/lib/icons-remix';
import { useQuery } from '@tanstack/react-query';
import { useUnit } from 'effector-react';
import { AnimatePresence, MotionConfig } from 'motion/react';
import type { Drawing } from '@repo/types';
import { AskUserQuestions } from '@repo/design-system/components/ui/ask-user-questions';
import { Button } from '@repo/design-system/components/ui/button';
import { InputMessage } from '@repo/design-system/components/ui/input-message';
import { annotationMarker, annotationContextSchema } from './annotation-context';
import { ChatMessage } from '@repo/design-system/components/ui/chat-message';
import { trpc } from '@/shared/trpc';
import { $$drawings } from './model';
import { DrawingActivity } from './drawing-activity';
import { DrawingProgress } from './drawing-progress';
import { ChatMarkdown } from './chat-markdown';
import { DrawingToolTrace } from './drawing-tool-trace';
import { DrawingAnswer } from './drawing-answer';

const questionLimit = 4000;

function UserQuestion({ question, model, drawing }: Readonly<{ question: string; model?: CommentsModel; drawing: Drawing }>) {
    const markerIndex = question.lastIndexOf(annotationMarker);
    if (markerIndex < 0) return <>{question}</>;
    let context;
    try {
        context = annotationContextSchema.safeParse(JSON.parse(question.slice(markerIndex + annotationMarker.length)));
    } catch {
        return <>{question}</>;
    }
    if (!context.success) return <>{question}</>;
    const available = drawing.blueprints.some((blueprint) => blueprint.pageNumber === context.data.sheet && !blueprint.attachment.hiddenFromCanvas);
    return (
        <div className="flex min-w-0 flex-col items-start gap-2 whitespace-normal">
            <button
                type="button"
                disabled={!model || !available}
                title={available ? undefined : 'Show this blueprint to focus the annotation'}
                onClick={() => model?.annotationFocusRequested(context.data)}
                className="flex max-w-full items-center gap-2 border border-foreground/20 bg-black/5 px-2.5 py-2 text-left text-xs text-foreground hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-ring dark:bg-black/15 dark:hover:bg-black/25 disabled:cursor-default"
                aria-label={`Focus ${context.data.label} on sheet ${context.data.sheet}`}
            >
                <MessageSquare size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 truncate">
                    {context.data.label} · Sheet {context.data.sheet}
                </span>
            </button>
            <div className="max-w-full whitespace-pre-wrap [overflow-wrap:anywhere]">{question.slice(0, markerIndex)}</div>
        </div>
    );
}

export function DrawingChat({ id, previewDrawing, commentsModel }: Readonly<{ id: string; previewDrawing?: Drawing; commentsModel?: CommentsModel }>) {
    const { draft, error, activity, asking, outgoing, stages, stopping } = useUnit({
        stopping: $$drawings.$stopping,
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
    const [tab, setTab] = useState<number>(0);
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
    const activeQuestion = drawing.busy ? drawing.messages.find((message) => !message.answer) : undefined;
    const latestMessage = messages.at(-1);
    const answer = latestMessage?.answer;
    const clarification = !pending && answer?.status === 'needs_clarification' ? answer.clarificationQuestion : null;
    const clarificationId = latestMessage?.id ?? 'clarification';
    const visibleError = error?.id === id ? error.message : drawing.error;
    const ask = (message: Drawing['messages'][number]) => {
        if (!drawing.blueprints.length || busy || asking || submissionsRef.current.has(id)) return;
        submissionsRef.current.add(id);
        $$drawings.draftChanged('');
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
                <Tabs selectedIndex={tab} onSelect={setTab} className="z-10 m-0 max-w-full shrink-0 border-b bg-card p-0">
                    <TabsItem
                        index={0}
                        label="Chat"
                        icon={remixIcons['message-circle']}
                        className="h-10 min-w-0 flex-1 basis-0 items-center justify-center px-3 py-2"
                    />
                    <TabsItem index={1} label="Comments" icon={MessageSquare} className="h-10 min-w-0 flex-1 basis-0 items-center justify-center px-3 py-2" />
                </Tabs>
                <div hidden={tab !== 1} className="min-h-0 flex-1 overflow-y-auto">
                    {commentsModel && !previewDrawing ? (
                        <DrawingComments drawing={drawing} model={commentsModel} />
                    ) : (
                        <p className="p-4 text-sm text-muted-foreground">Sign in to add comments to a blueprint.</p>
                    )}
                </div>
                <div hidden={tab !== 0} className="min-h-0 flex-1 flex-col overflow-hidden" style={{ display: tab === 0 ? 'flex' : 'none' }}>
                    <div role="log" aria-label="Conversation" className="min-h-0 flex-1 overflow-y-auto p-4">
                        <div className="flex min-h-full flex-col justify-end gap-5">
                            <DrawingProgress
                                drawing={drawing}
                                busy={busy}
                                stage={stages[id] ?? undefined}
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
                                    <ChatMarkdown>
                                        {drawing.blueprints
                                            .map((blueprint) => blueprint.layout?.summary)
                                            .filter(Boolean)
                                            .join('\n')}
                                    </ChatMarkdown>
                                </ChatMessage>
                            )}
                            <AnimatePresence initial={false}>
                                {messages.flatMap((message) => [
                                    <ChatMessage key={`${message.id}-user`} from="user">
                                        <UserQuestion question={message.question} model={commentsModel} drawing={drawing} />
                                    </ChatMessage>,
                                    message.answer || message.trace?.length || (pending?.id === message.id && busy) ? (
                                        <ChatMessage key={`${message.id}-assistant`} from="assistant" className="w-full max-w-full items-stretch">
                                            <DrawingToolTrace drawing={drawing} message={message} busy={busy} />
                                            {message.answer && (
                                                <>
                                                    {message.answer.status === 'cannot_determine' && (
                                                        <p className="text-muted-foreground mb-2 text-xs font-medium">
                                                            Cannot determine from available information
                                                        </p>
                                                    )}
                                                    <DrawingAnswer answer={message.answer} drawing={drawing} />
                                                    {message.answer.status === 'needs_clarification' &&
                                                        message.answer.clarificationQuestion &&
                                                        message.id !== (clarification ? latestMessage?.id : null) && (
                                                            <div className="mt-3 border-t pt-3">
                                                                <p className="text-primary text-xs font-medium">More information needed</p>
                                                                <div className="mt-1">
                                                                    <ChatMarkdown>{message.answer.clarificationQuestion}</ChatMarkdown>
                                                                </div>
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
                                                </>
                                            )}
                                        </ChatMessage>
                                    ) : null,
                                ])}
                            </AnimatePresence>
                            {!pending && drawing.blueprints.length > 0 && (activity[id] ?? 0) > 0 && (
                                <DrawingActivity label={stages[id] ?? 'Starting analysis'} />
                            )}
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
                            {commentsModel && <AnnotationChatNavigation model={commentsModel} onSelectChat={setTab} />}
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
                                status={activeQuestion ? 'streaming' : 'idle'}
                                onStop={() => {
                                    if (activeQuestion && !stopping) void $$drawings.stopFx({ id, messageId: activeQuestion.id }).catch(() => {});
                                }}
                                showQueue={false}
                                placeholder="Message…"
                                sendLabel="Send message"
                                minRows={1}
                                maxRows={6}
                                disabled={activeQuestion ? stopping : !drawing.blueprints.length || busy || !!pending || asking}
                                textareaProps={{ 'aria-label': 'Message', maxLength: questionLimit, autoComplete: 'off', readOnly: !!activeQuestion }}
                            />
                        )}
                    </div>
                </div>
            </section>
        </MotionConfig>
    );
}
