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
        mobile: resolve(__dirname, 'mobile-src.html'),
        antenna: resolve(__dirname, 'antenna-src.html'),
        'gs-planner': resolve(__dirname, 'gs-planner-src.html'),
        'imaging-planner': resolve(__dirname, 'imaging-planner-src.html'),
        'imaging-planner-3d': resolve(__dirname, 'imaging-planner-3d-src.html'),
        'pass-tracker': resolve(__dirname, 'pass-tracker-src.html'),
        'gag': resolve(__dirname, 'gag-src.html'),
        'imaging': resolve(__dirname, 'imaging-src.html'),
        'stations': resolve(__dirname, 'stations-src.html'),
      },
    },
  },
  server: {
    open: false,
  },
  // In dev mode, open http://localhost:5173/dev.html
});
