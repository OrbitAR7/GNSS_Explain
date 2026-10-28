import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// CelesTrak is proxied through the dev/preview server so the live element-set
// download is not subject to browser cross-origin rules.
const celestrakProxy = {
  '/celestrak': {
    target: 'https://celestrak.org',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/celestrak/, ''),
  },
};

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      // satellite.js's package entry also pulls in its WebAssembly build; only the
      // pure-JS SGP4 modules are needed.
      'satellite-js-dist': fileURLToPath(new URL('./node_modules/satellite.js/dist', import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => (id.includes('node_modules/cesium') || id.includes('node_modules/@cesium') ? 'cesium' : undefined),
      },
    },
  },
  server: { proxy: celestrakProxy },
  preview: { proxy: celestrakProxy },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
