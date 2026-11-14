import { useState } from 'react';
import { Input } from '@repo/design-system/components/ui/input';
import { Tooltip } from '@repo/design-system/components/ui/tooltip';
import { useQuery } from '@tanstack/react-query';
import { useUnit } from 'effector-react';
import type { Drawing, ScanComment } from '@repo/types';
import { BrandLogo } from '@repo/design-system/components/ui/brand-logo';
import { Button } from '@repo/design-system/components/ui/button';
import { MessageAdd, Search } from '@repo/design-system/lib/icons-remix';
import { trpc } from '@/shared/trpc';
import type { CommentsModel } from './canvas/comments-model';

export function commentAuthor(comment: ScanComment) {
    return comment.source === 'ppm' ? 'Pirto' : (comment.author?.name ?? 'Unknown author');
}

export function CommentAuthor({ comment }: Readonly<{ comment: ScanComment }>) {
    const name = commentAuthor(comment);
    return (
        <div className="flex min-w-0 items-center gap-3">
            <span
                aria-hidden
                className={`flex size-8 shrink-0 items-center justify-center text-sm font-semibold ${comment.source === 'ppm' ? 'bg-primary' : 'bg-primary/50'} text-white`}
            >
                {comment.source === 'ppm' ? <BrandLogo iconOnly className="!h-6" /> : name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" title={name}>
                    {name}
                </p>
                <p className="text-xs text-muted-foreground">
                    {comment.createdAt && (
                        <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
                            {new Date(comment.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </time>
                    )}
                </p>
            </div>
        </div>
    );
}

export function DrawingComments({ drawing, model }: Readonly<{ drawing: Drawing; model: CommentsModel }>) {
    const openId = useUnit(model.$openId);
    const [search, setSearch] = useState('');
    const {
        data = [],
        isPending,
        error,
        refetch,
    } = useQuery({
        ...trpc.drawings.comments.list.queryOptions({ drawingId: drawing.id }),
        initialData: drawing.blueprints.flatMap((blueprint) => blueprint.comments),
    });
    const query = search.trim().toLocaleLowerCase();
    const comments = data.filter(
        (comment) =>
            !comment.deletedAt &&
            (query.startsWith('@') ? commentAuthor(comment).toLocaleLowerCase().includes(query.slice(1)) : comment.text.toLocaleLowerCase().includes(query)),
    );

    const visiblePages = new Set(drawing.blueprints.filter((blueprint) => !blueprint.attachment.hiddenFromCanvas).map((blueprint) => blueprint.pageNumber));
    const available = visiblePages.size > 0;
    return (
        <div className="space-y-4 p-4">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">
                    Comments <span className="text-muted-foreground">{comments.length}</span>
                </h3>
                <Tooltip content="Add comment" shortcut="C">
                    <Button size="compact" variant="ghost" disabled={!available} leadingIcon={MessageAdd} onClick={() => model.modeChanged('comment')}>
                        Add comment
                    </Button>
                </Tooltip>
            </div>
            <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    style={{ paddingLeft: 36 }}
                    aria-label="Search comments"
                    placeholder="Search comments or @author…"
                    value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)}
                />
            </div>
            {isPending && (
                <p role="status" className="text-sm text-muted-foreground">
                    Loading comments…
                </p>
            )}
            {error && (
                <div role="alert" className="text-sm text-destructive">
                    Could not load comments.{' '}
                    <Button size="compact" variant="ghost" onClick={() => void refetch()}>
                        Retry
                    </Button>
                </div>
            )}
            {!isPending && !error && !comments.length && (
                <p className="text-sm text-muted-foreground">
                    {query
                        ? 'No matching comments.'
                        : available
                          ? 'Choose Add comment or press C, then click your blueprint.'
                          : 'Upload a blueprint to start commenting.'}
                </p>
            )}
            <div className="space-y-3">
                {comments.map((comment) => (
                    <Button
                        key={comment.id}
                        variant="ghost"
                        disabled={!visiblePages.has(comment.page)}
                        active={openId === comment.id}
                        className="h-auto w-full justify-start whitespace-normal border p-3 text-left"
                        onClick={() => model.focusRequested(comment.id)}
                    >
                        <div className="w-full min-w-0">
                            <div className="mb-2 text-xs text-muted-foreground">#{comment.number ?? '·'}</div>
                            <CommentAuthor comment={comment} />
                            <p className="mt-3 line-clamp-3 break-words text-sm font-normal">{comment.text}</p>
                        </div>
                    </Button>
                ))}
            </div>
        </div>
    );
}
