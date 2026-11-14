import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ChatMarkdown({ children }: Readonly<{ children: string }>) {
    return (
        <div className="min-w-0 whitespace-normal break-words [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_h1]:my-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-semibold [&_a]:text-primary [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:bg-muted [&_pre]:p-3 [&_code]:whitespace-pre-wrap [&_code]:font-mono [&_code]:text-sm [&_table]:my-2 [&_table]:block [&_table]:overflow-x-auto [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:px-2 [&_td]:py-1">
            <Markdown remarkPlugins={[remarkGfm]} skipHtml>
                {children}
            </Markdown>
        </div>
    );
}
