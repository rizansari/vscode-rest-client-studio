import react from '@vitejs/plugin-react';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root,
    // relative asset URLs: the webview serves files from the extension folder, not the origin root
    base: './',
    plugins: [react()],
    build: {
        outDir: path.resolve(root, '../dist/webview'),
        emptyOutDir: true,
        sourcemap: false,
        chunkSizeWarningLimit: 2000,
        rollupOptions: {
            input: path.resolve(root, 'src/main.tsx'),
            output: {
                entryFileNames: 'index.js',
                assetFileNames: (asset) => asset.name?.endsWith('.css') ? 'index.css' : '[name][extname]',
            },
        },
    },
});
