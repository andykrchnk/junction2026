import { useState } from 'react';
import { AskUserQuestions } from '../components/ui/ask-user-questions';
import { ChatMessage } from '../components/ui/chat-message';
import { InputMessage } from '../components/ui/input-message';

export default { title: 'Current/Canvas chat', decorators: [(Story: () => React.ReactNode) => <div className="w-80 bg-card p-4"><Story /></div>] };
export const Clarification = {
    render: () => <AskUserQuestions className="chat-clarification-input bg-[var(--chat-input-background)]" questions={[{ title: 'Which floor plan should I review?', freeText: true, freeTextPlaceholder: 'Type your reply…', nextLabel: 'Send reply', skippable: false }]} />,
};
export const Messages = {
    render: () => <div className="flex flex-col gap-5"><ChatMessage from="user">How many rooms are here?</ChatMessage><ChatMessage from="assistant" className="w-full max-w-full">I can help review the rooms identified on this blueprint.</ChatMessage></div>,
};
export const Composer = { render: function ComposerPreview() { const [value, setValue] = useState(''); return <InputMessage value={value} onValueChange={setValue} placeholder="Message…" showQueue={false} />; } };
