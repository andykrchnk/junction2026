import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUnit } from 'effector-react';
import { AnimatePresence, MotionConfig } from 'motion/react';
import { ArrowUp, FileUp, FileText, RefreshCw } from '@repo/design-system/lib/icons-remix';
import { Button } from '@repo/design-system/components/ui/button';
import { Input } from '@repo/design-system/components/ui/input';
import { ChatMessage } from '@repo/design-system/components/ui/chat-message';
import { trpc } from '@/shared/trpc';
import { $$drawings } from '@/features/drawings/model';
import { BlueprintPreview } from '@/features/drawings/blueprint-preview';
import { AnalysisMetadata } from '@/features/drawings/analysis-metadata';

export function DrawingWorkspace({ id }: Readonly<{ id: string }>) {
    const {
        data: drawing,
        isPending,
        error: loadError,
    } = useQuery({
        ...trpc.drawings.get.queryOptions({ id }),
        refetchInterval: (query) => (query.state.data?.busy ? 2000 : false),
    });
    const { draft, error, uploading, activity, asking } = useUnit({
        draft: $$drawings.$draft,
        error: $$drawings.$error,
        uploading: $$drawings.$uploading,
        activity: $$drawings.$activity,
        asking: $$drawings.$asking,
    });
    const endRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'nearest' });
    }, [drawing?.messages.length, drawing?.messages.at(-1)?.answer]);
    if (isPending)
        return (
            <p role="status" className="p-8 text-sm">
                Opening drawing…
            </p>
        );
    if (!drawing)
        return (
            <p role="alert" className="p-8 text-sm text-destructive">
                {loadError?.message ?? 'Drawing not found.'}
            </p>
        );
    const busy = drawing.busy || (activity[id] ?? 0) > 0;
    const pending = drawing.messages.find((message) => !message.answer);
    const latestAnswer = drawing.messages.at(-1)?.answer;
    const clarification = !pending && latestAnswer?.status === 'needs_clarification' ? latestAnswer.clarificationQuestion : null;
    const visibleError = error?.id === id ? error.message : drawing.error;
    const ask = (question: string) => {
        void $$drawings.askFx({ id, message: { id: crypto.randomUUID(), question, answer: null } }).catch(() => {});
    };
    return (
        <MotionConfig reducedMotion="user">
            <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-6 md:px-8">
                <header className="mb-6 border-b pb-5">
                    <p className="text-primary text-xs font-medium">Drawing workspace</p>
                    <h1 className="mt-2 break-words text-xl font-medium">{drawing.title}</h1>
                    <p className="text-muted-foreground mt-2 text-sm">
                        {drawing.analysis ? 'Answers use your saved analysis and the details you provide.' : 'One blueprint. A clearer starting point.'}
                    </p>
                </header>
                {visibleError && (
                    <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-card p-3 text-sm text-destructive">
                        {visibleError}
                    </p>
                )}
                {!drawing.attachment ? (
                    <div className="bg-card my-auto rounded-lg border border-dashed p-8 text-center">
                        <FileUp className="text-primary mx-auto mb-4 size-8" aria-hidden />
                        <h2 className="text-lg font-medium">Start with a blueprint</h2>
                        <p className="text-muted-foreground mt-2 text-sm">Upload one JPEG, PNG or PDF, up to 20 MB. PDFs can have up to 10 pages.</p>
                        <label htmlFor="blueprint" className="mt-6 mb-2 block text-left text-sm">
                            Blueprint file
                        </label>
                        <Input
                            id="blueprint"
                            type="file"
                            accept="image/jpeg,image/png,application/pdf"
                            disabled={busy}
                            onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                if (file) void $$drawings.uploadFx({ id, file }).catch(() => {});
                                event.currentTarget.value = '';
                            }}
                        />
                        {uploading && busy && (
                            <p className="mt-3 text-sm" role="status">
                                Saving your blueprint…
                            </p>
                        )}
                    </div>
                ) : (
                    <>
                        <BlueprintPreview key={id} drawing={drawing} />
                        {!drawing.analysis && (
                            <div className="py-10 text-center">
                                <FileText className="text-primary mx-auto mb-3 size-7" aria-hidden />
                                <p role="status" className="mb-4 text-sm">
                                    {busy ? 'Analyzing your blueprint. You can return to this session later.' : 'Prepare the analysis to start chatting.'}
                                </p>
                                <Button
                                    loading={busy}
                                    leadingIcon={RefreshCw}
                                    onClick={() => {
                                        void $$drawings.analyzeFx(id).catch(() => {});
                                    }}
                                >
                                    {visibleError ? 'Retry analysis' : 'Analyze blueprint'}
                                </Button>
                            </div>
                        )}
                        {drawing.analysis && (
                            <>
                                <details className="my-4 rounded-md border bg-card p-4" open={drawing.messages.length === 0}>
                                    <summary className="cursor-pointer text-sm font-medium">
                                        Initial analysis · {drawing.analysis.observations.length} observations
                                    </summary>
                                    <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{drawing.analysis.summary}</p>
                                    <AnalysisMetadata analysis={drawing.analysis} />
                                    <ul className="text-muted-foreground mt-3 list-disc space-y-1 pl-5 text-xs">
                                        {drawing.analysis.limitations.map((limitation, index) => (
                                            <li key={index}>{limitation}</li>
                                        ))}
                                    </ul>
                                    {drawing.analysis.missingInformation.length > 0 && (
                                        <div className="mt-4 text-sm">
                                            <p className="font-medium">Missing information</p>
                                            <ul className="mt-2 list-disc space-y-1 pl-5">
                                                {drawing.analysis.missingInformation.map((item, index) => (
                                                    <li key={index}>{item}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    <div className="mt-4 space-y-3">
                                        {drawing.analysis.observations.map((item, index) => (
                                            <div key={index} className="border-t pt-3 text-sm">
                                                <p className="font-medium">
                                                    Page {item.page} · {item.location}
                                                </p>
                                                <p className="mt-1">{item.fact}</p>
                                                <p className="text-muted-foreground mt-1 text-xs">Evidence: {item.evidence}</p>
                                                {item.assumptions.length > 0 && (
                                                    <div className="mt-2 text-xs">
                                                        <p className="font-medium">Assumptions · unverified</p>
                                                        <ul className="mt-1 list-disc space-y-1 pl-5">
                                                            {item.assumptions.map((assumption, index) => (
                                                                <li key={index}>{assumption}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </details>
                                <div role="log" aria-label="Conversation" className="flex flex-1 flex-col gap-5 py-4">
                                    <AnimatePresence initial={false}>
                                        {drawing.messages.flatMap((message) => [
                                            <ChatMessage key={`${message.id}-user`} from="user">
                                                {message.question}
                                            </ChatMessage>,
                                            message.answer ? (
                                                <ChatMessage key={`${message.id}-assistant`} from="assistant">
                                                    {message.answer.status === 'cannot_determine' && (
                                                        <p className="text-muted-foreground mb-2 text-xs font-medium">
                                                            Cannot determine from available information
                                                        </p>
                                                    )}
                                                    {message.answer.text}
                                                    {message.answer.status === 'needs_clarification' && message.answer.clarificationQuestion && (
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
                                    {busy && (
                                        <p role="status" className="text-muted-foreground text-sm">
                                            Preparing an answer…
                                        </p>
                                    )}
                                    {pending && !busy && (
                                        <Button
                                            variant="secondary"
                                            className="self-start"
                                            onClick={() => {
                                                void $$drawings.askFx({ id, message: pending }).catch(() => {});
                                            }}
                                        >
                                            Retry answer
                                        </Button>
                                    )}
                                    <div ref={endRef} />
                                </div>
                                <form
                                    className="bg-background mt-4 border-t py-4 md:sticky md:bottom-0"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        if (draft.trim() && !busy && !pending) ask(draft.trim());
                                    }}
                                >
                                    <label htmlFor="question" className="mb-2 block text-xs text-muted-foreground">
                                        {clarification ? 'Your reply to the clarification' : 'Ask about this drawing'}
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            id="question"
                                            value={draft}
                                            onChange={(event) => $$drawings.draftChanged(event.target.value)}
                                            placeholder={clarification ?? 'How much floor tiling do the toilets need?'}
                                            maxLength={4000}
                                            disabled={busy || !!pending}
                                            autoComplete="off"
                                        />
                                        <Button
                                            type="submit"
                                            size="icon"
                                            aria-label="Send question"
                                            disabled={!draft.trim() || !!pending || busy}
                                            loading={asking && busy}
                                        >
                                            <ArrowUp className="size-4" />
                                        </Button>
                                    </div>
                                    {clarification && (
                                        <p className="text-primary mt-2 text-xs" role="status">
                                            Waiting for your reply to continue answering.
                                        </p>
                                    )}
                                    <p className="text-muted-foreground mt-2 text-xs">
                                        Prototype analysis may miss details. Check quantities against the original drawing.
                                    </p>
                                </form>
                            </>
                        )}
                    </>
                )}
            </section>
        </MotionConfig>
    );
}
