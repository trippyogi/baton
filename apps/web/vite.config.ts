import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@baton/sdk': path.resolve(__dirname, '../../packages/sdk/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4200',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
