import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'dev.html'),
    },
  },
  server: {
    open: false,
  },
  // In dev mode, open http://localhost:5173/dev.html
});
