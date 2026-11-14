import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    resolve: {
        dedupe: ['react', 'react-dom'],
        alias: {
            '@/components/ui': fileURLToPath(new URL('../../design-system/src/components/ui', import.meta.url)),
            '@/lib': fileURLToPath(new URL('../../design-system/src/lib', import.meta.url)),
            '@/hooks': fileURLToPath(new URL('../../design-system/src/hooks', import.meta.url)),
            '@/components/fluid-hover-highlight': fileURLToPath(new URL('../../design-system/src/components/fluid-hover-highlight', import.meta.url)),
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    // Bundle shared UI dependencies so SSR also uses the platform's React instance.
    ssr: { noExternal: ['motion', 'framer-motion', '@untitledui/icons', '@base-ui/react'] },
    plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), viteReact()],
    server: { strictPort: true },
});
