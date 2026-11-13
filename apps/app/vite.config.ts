import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), viteReact()],
    server: { strictPort: true },
});
