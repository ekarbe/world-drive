import { defineConfig } from 'vite';

// Served from https://ekarbe.github.io/world-drive/
export default defineConfig({
  base: '/world-drive/',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
});
