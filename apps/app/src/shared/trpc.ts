import { authenticatedFetch } from '@/shared/auth';
import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from '@repo/server/router';
import { config } from '@/shared/config';

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
export const trpcClient = createTRPCClient<AppRouter>({
    links: [httpLink({ url: `${config.API_URL}/api/trpc`, fetch: authenticatedFetch })],
});
export const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient });
