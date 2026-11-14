import { createRouter, defaultParseSearch } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
    return createRouter({
        routeTree,
        scrollRestoration: true,
        defaultPreloadStaleTime: 0,
        parseSearch: (search) => {
            const parsed = defaultParseSearch(search);
            // Numeric-only ObjectIds must retain all 24 digits in pasted URLs.
            const drawing = new URLSearchParams(search).get('drawing');
            if (drawing && /^[a-fA-F0-9]{24}$/.test(drawing)) return { ...parsed, drawing };
            return parsed;
        },
    });
}

declare module '@tanstack/react-router' {
    interface Register {
        router: ReturnType<typeof getRouter>;
    }
}
