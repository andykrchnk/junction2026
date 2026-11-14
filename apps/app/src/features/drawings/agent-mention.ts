// A standalone mention is a routing command; email addresses and longer handles are ordinary text.
const agentMentionPattern = /(^|\s)@agent(?=\s|$|[!?;:,]|\.(?:\s|$))/i;

export function hasAgentMention(text: string): boolean {
    return agentMentionPattern.test(text);
}

export function removeAgentMention(text: string): string {
    return text.replace(/(^|\s)@agent(?=\s|$|[!?;:,]|\.(?:\s|$))/gi, '$1').trim();
}
