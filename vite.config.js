import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dev: resolve(__dirname, 'dev.html'),
        mobile: resolve(__dirname, 'mobile.html'),
        antenna: resolve(__dirname, 'antenna.html'),
      },
    },
  },
  server: {
    open: false,
  },
  // In dev mode, open http://localhost:5173/dev.html
});
