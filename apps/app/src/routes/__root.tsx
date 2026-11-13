import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import appCss from '../styles.css?url';

export const Route = createRootRoute({
    head: () => ({
        meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Junction — Drawing workspace' }],
        links: [{ rel: 'stylesheet', href: appCss }],
    }),
    shellComponent: RootDocument,
    notFoundComponent: () => (
        <main className="p-12">
            <h1 className="text-2xl">Page not found</h1>
            <Link to="/" className="underline">
                Back to workspace
            </Link>
        </main>
    ),
});

function RootDocument(props: Readonly<{ children: ReactNode }>) {
    const { children } = props;
    return (
        <html lang="en">
            <head>
                <HeadContent />
            </head>
            <body>
                {children}
                <Scripts />
            </body>
        </html>
    );
}
