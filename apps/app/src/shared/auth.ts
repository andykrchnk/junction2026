import { createAuthClient } from 'better-auth/react';
import { config } from '@/shared/config';

const tokenStorageKey = 'junction_bearer_token';
let authVersion = 0;
export const getAuthVersion = () => authVersion;
export const getBearerToken = () => (typeof window === 'undefined' ? null : localStorage.getItem(tokenStorageKey));
export function clearBearerToken() {
    authVersion += 1;
    if (typeof window !== 'undefined') localStorage.removeItem(tokenStorageKey);
}
function storeBearerToken(response: Response) {
    const token = response.headers.get('set-auth-token');
    if (token && typeof window !== 'undefined') localStorage.setItem(tokenStorageKey, token);
}
export async function authenticatedFetch(url: RequestInfo | URL, options?: RequestInit) {
    const token = getBearerToken();
    const version = authVersion;
    const headers = new Headers(options?.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { ...options, headers, credentials: 'include' });
    // Requests started before sign-out must not restore an invalidated bearer token.
    if (version === authVersion && token === getBearerToken()) storeBearerToken(response);
    return response;
}
export const authClient = createAuthClient({
    baseURL: config.API_URL,
    fetchOptions: {
        credentials: 'include',
        onRequest: (ctx) => {
            const token = getBearerToken();
            if (token) ctx.headers.set('Authorization', `Bearer ${token}`);
            return ctx;
        },
        onSuccess: (ctx) => {
            storeBearerToken(ctx.response);
        },
    },
});
