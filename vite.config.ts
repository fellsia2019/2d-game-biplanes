import { defineConfig } from 'vite';
export default defineConfig({ base: './', server: { proxy: { '/socket': { target: 'ws://127.0.0.1:5187', ws: true } } }, build: { chunkSizeWarningLimit: 1600, rollupOptions: { input: { game: 'index.html', models: 'models.html' } } } });
