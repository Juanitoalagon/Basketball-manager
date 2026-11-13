import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base relativa: la app funciona en cualquier subcarpeta (GitHub Pages).
export default defineConfig({
  base: './',
  build: { outDir: 'docs', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,svg}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      manifest: {
        name: 'Basketball Manager Advanced',
        short_name: 'BM Advanced',
        description: 'Simulador y gestión de baloncesto. Todo se guarda en tu dispositivo.',
        lang: 'es',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#11151c',
        theme_color: '#11151c',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'], exclude: ['tests/calib-run.test.ts'] },
});
