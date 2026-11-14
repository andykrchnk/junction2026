import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    resolve: {
        dedupe: ['react', 'react-dom'],
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    // Bundle shared UI dependencies so SSR also uses the platform's React instance.
    ssr: { noExternal: ['@repo/design-system', 'motion', 'framer-motion', '@untitledui/icons', '@base-ui/react'] },
    plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), viteReact()],
    server: { strictPort: true },
});
