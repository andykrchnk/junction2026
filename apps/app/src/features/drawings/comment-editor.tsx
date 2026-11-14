import { useId, useRef, useState } from 'react';
import { Button } from '@repo/design-system/components/ui/button';
import { Textarea } from '@repo/design-system/components/ui/textarea';
import { CommandMenu, CommandMenuList, CommandMenuItem } from '@repo/design-system/components/ui/command-menu';
import { ArrowRight } from '@repo/design-system/lib/icons-remix';
import { hasAgentMention, removeAgentMention } from './agent-mention';

type Mention = Readonly<{ start: number; end: number; query: string }>;
const agents = [{ value: 'agent', label: 'agent' }];

function activeMention(input: HTMLTextAreaElement): Mention | null {
    const prefix = input.value.slice(0, input.selectionStart);
    const match = /(^|\s)@([a-z]*)$/i.exec(prefix);
    if (!match || !'agent'.startsWith(match[2]?.toLowerCase() ?? '')) return null;
    return { start: prefix.lastIndexOf('@'), end: input.selectionEnd, query: match[2] ?? '' };
}

export function CommentEditor({
    text,
    error,
    creating,
    deleting,
    onTextChange,
    onSubmit,
}: Readonly<{
    text: string;
    error: string | null;
    creating: boolean;
    deleting: boolean;
    onTextChange: (text: string) => void;
    onSubmit: () => void;
}>) {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [mention, setMention] = useState<Mention | null>(null);
    const menuId = useId();
    const tagged = hasAgentMention(text);
    const disabled = creating || deleting || !(tagged ? removeAgentMention(text) : text).trim();
    const selectAgent = () => {
        const input = inputRef.current;
        if (!input || !mention) return;
        const remainingWord = /^[a-z]*/i.exec(input.value.slice(mention.end))?.[0] ?? '';
        const end = mention.end + remainingWord.length;
        const replacement = /^\s/.test(input.value.slice(end)) ? '@agent' : '@agent ';
        if (input.value.length - (end - mention.start) + replacement.length > input.maxLength) return;
        input.setRangeText(replacement, mention.start, end, 'end');
        onTextChange(input.value);
        setMention(null);
        input.focus();
    };
    return (
        <form
            className="flex flex-col"
            onSubmit={(event) => {
                event.preventDefault();
                if (!disabled) onSubmit();
            }}
        >
            <div className="relative">
                <Textarea
                    ref={inputRef}
                    autoFocus
                    placeholder="Write a comment…"
                    aria-label="Comment text"
                    aria-autocomplete="list"
                    aria-haspopup="listbox"
                    aria-expanded={mention !== null}
                    aria-controls={mention ? `${menuId}-list` : undefined}
                    aria-activedescendant={mention ? `${menuId}-agent` : undefined}
                    value={text}
                    maxLength={6000}
                    rows={4}
                    disabled={creating}
                    onChange={(event) => {
                        onTextChange(event.currentTarget.value);
                        setMention(activeMention(event.currentTarget));
                    }}
                    onSelect={(event) => setMention(activeMention(event.currentTarget))}
                    onBlur={() => setMention(null)}
                    onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return;
                        if (mention && !event.metaKey && ['Enter', 'Tab', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
                            event.preventDefault();
                            event.stopPropagation();
                            if (!event.repeat && (event.key === 'Enter' || event.key === 'Tab')) selectAgent();
                            return;
                        }
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.repeat) return;
                        if (event.metaKey) {
                            const input = event.currentTarget;
                            if (input.value.length - (input.selectionEnd - input.selectionStart) >= input.maxLength) return;
                            input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
                            onTextChange(input.value);
                            setMention(null);
                        } else if (!disabled) onSubmit();
                    }}
                />
                {mention && !creating && (
                    <CommandMenu
                        items={agents}
                        query={mention.query}
                        onSelect={selectAgent}
                        size="compact"
                        className="absolute inset-x-0 top-full z-20 border bg-popover text-popover-foreground shadow-md"
                    >
                        <CommandMenuList
                            id={`${menuId}-list`}
                            aria-label="Mention agent"
                            renderItem={(item) => <CommandMenuItem id={`${menuId}-agent`} value={item.value} />}
                        />
                    </CommandMenu>
                )}
            </div>
            {error && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                    {error}
                </p>
            )}
            <Button
                className="mt-3 self-end"
                type="submit"
                size="compact"
                disabled={disabled}
                loading={creating}
                trailingIcon={tagged ? ArrowRight : undefined}
            >
                {tagged ? 'Send' : error ? 'Retry' : 'Post'}
            </Button>
        </form>
    );
}
