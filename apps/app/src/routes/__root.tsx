import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/shared/trpc';
import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { FluidProvider } from '@/lib/fluid-provider';
import { untitleduiIcons } from '@/lib/icons-untitledui';
import { ThemeProvider } from 'next-themes';
import appCss from '../styles.css?url';

export const Route = createRootRoute({
    head: () => ({
        meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Pirto — Drawing workspace' }],
        links: [
            { rel: 'stylesheet', href: appCss },
            { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        ],
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
        <html lang="en" suppressHydrationWarning>
            <head>
                <HeadContent />
            </head>
            <body>
                <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                    <FluidProvider shape="sharp" size="default" icons={untitleduiIcons}>
                        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
                    </FluidProvider>
                </ThemeProvider>
                <Scripts />
            </body>
        </html>
    );
}
