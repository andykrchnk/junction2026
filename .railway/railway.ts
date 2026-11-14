import { defineRailway, github, preserve, project, service } from 'railway/iac';
import type { BuildConfig } from 'railway/iac';

const region = 'europe-west4-drams3a';
const restart = { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 10 } as const;

const appBuild = {
    builder: 'DOCKERFILE',
    dockerfilePath: 'apps/app/Dockerfile.railway',
    watchPatterns: [
        'apps/app/**',
        'design-system/**',
        'apps/server/src/trpc/**',
        'apps/server/src/shared/trpc.ts',
        'packages/**',
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
    ],
} satisfies BuildConfig;
const serverBuild = {
    builder: 'DOCKERFILE',
    dockerfilePath: 'apps/server/Dockerfile.railway',
    watchPatterns: ['apps/server/**', 'packages/**', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'],
} satisfies BuildConfig;

export default defineRailway((context) => {
    const source = github('andykrchnk/junction2026', { branch: 'master', checkSuites: true });
    const app = service('@repo/app', {
        source,
        build: appBuild,
        deploy: { ...restart, healthcheckPath: '/' },
        replicas: { [region]: 1 },
        env: { PORT: '8080', VITE_API_URL: context.shared.API_URL, VITE_TLDRAW_LICENSE_KEY: preserve() },
    });
    const server = service('@repo/server', {
        source,
        build: serverBuild,
        deploy: { ...restart, healthcheckPath: '/health', healthcheckTimeout: 120 },
        replicas: { [region]: 1 },
        env: {
            OPENAI_API_KEY: preserve(),
            INFERENCE_BASE_URL: preserve(),
            INFERENCE_API_KEY: preserve(),
            INFERENCE_TIMEOUT_MS: preserve(),
            NODE_ENV: 'production',
            PORT: '8080',
            APP_ORIGIN: context.shared.APP_ORIGIN,
            BETTER_AUTH_URL: context.shared.API_URL,
            BETTER_AUTH_SECRET: preserve(),
            MONGODB_URI: preserve(),
            MONGODB_DB_NAME: preserve(),
        },
    });
    return project('junction2026', { resources: [app, server] });
});
