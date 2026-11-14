import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUnit } from 'effector-react';
import { AnimatePresence, MotionConfig } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChatMessage } from '@/components/ui/chat-message';
import { trpc } from '@/shared/trpc';
import { $$drawings } from './model';

export function DrawingChat({ id }: Readonly<{ id: string }>) {
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
    }, [drawing?.messages.length, drawing?.messages.at(-1)?.answer, drawing?.analysis]);
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
    const pending = drawing.messages.find((message) => !message.answer);
    const answer = drawing.messages.at(-1)?.answer;
    const clarification = !pending && answer?.status === 'needs_clarification' ? answer.clarificationQuestion : null;
    const visibleError = error?.id === id ? error.message : drawing.error;

    return (
        <MotionConfig reducedMotion="user">
            <section aria-label="Drawing chat" className="flex h-full min-h-0 flex-col">
                <div role="log" aria-label="Conversation" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
                    {drawing.analysis && <ChatMessage from="assistant">{drawing.analysis.summary}</ChatMessage>}
                    <AnimatePresence initial={false}>
                        {drawing.messages.flatMap((message) => [
                            <ChatMessage key={`${message.id}-user`} from="user">
                                {message.question}
                            </ChatMessage>,
                            message.answer ? (
                                <ChatMessage key={`${message.id}-assistant`} from="assistant">
                                    {message.answer.text}
                                    {message.answer.status === 'needs_clarification' && message.answer.clarificationQuestion && (
                                        <p className="mt-3">{message.answer.clarificationQuestion}</p>
                                    )}
                                </ChatMessage>
                            ) : null,
                        ])}
                    </AnimatePresence>
                    {busy && (
                        <p role="status" className="text-sm text-muted-foreground">
                            {uploading ? 'Uploading…' : !drawing.analysis ? 'Analyzing…' : 'Thinking…'}
                        </p>
                    )}
                    {visibleError && (
                        <p role="alert" className="text-sm text-destructive">
                            {visibleError}
                        </p>
                    )}
                    {pending && !busy && (
                        <Button
                            variant="ghost"
                            className="self-start"
                            onClick={() => {
                                void $$drawings.askFx({ id, message: pending }).catch(() => {});
                            }}
                        >
                            Retry
                        </Button>
                    )}
                    <div ref={endRef} />
                </div>
                <form
                    className="shrink-0 p-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (draft.trim() && drawing.attachment && !busy && !pending) {
                            void $$drawings.askFx({ id, message: { id: crypto.randomUUID(), question: draft.trim(), answer: null } }).catch(() => {});
                        }
                    }}
                >
                    {!drawing.attachment && (
                        <Input
                            aria-label="Upload blueprint"
                            className="mb-3"
                            type="file"
                            accept="image/jpeg,image/png,application/pdf"
                            disabled={busy}
                            onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                if (file) void $$drawings.uploadFx({ id, file }).catch(() => {});
                                event.currentTarget.value = '';
                            }}
                        />
                    )}
                    <div className="flex items-center gap-2">
                        <Input
                            aria-label={clarification ? 'Reply to clarification' : 'Message'}
                            value={draft}
                            onChange={(event) => $$drawings.draftChanged(event.target.value)}
                            placeholder="Message…"
                            maxLength={4000}
                            disabled={!drawing.attachment || busy || !!pending}
                            autoComplete="off"
                        />
                        <Button
                            type="submit"
                            size="icon"
                            aria-label="Send message"
                            disabled={!drawing.attachment || !draft.trim() || !!pending || busy}
                            loading={asking && busy}
                        >
                            <ArrowUp className="size-4" />
                        </Button>
                    </div>
                </form>
            </section>
        </MotionConfig>
    );
}
