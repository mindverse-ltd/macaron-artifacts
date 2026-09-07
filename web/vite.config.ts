import { defineConfig } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom', 'partial-react'] },
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      // Three SPA bundles: the claude UI at /index.html, the codex UI at
      // /codex.html, the kimi UI at /kimi.html. Fastify picks which one to
      // serve as `/` based on MACARON_ENGINE at boot.
      input: {
        main: path.resolve(__dirname, 'index.html'),
        codex: path.resolve(__dirname, 'codex.html'),
        kimi: path.resolve(__dirname, 'kimi.html'),
        // Clickability smoke harness (scripts/smoke/clickable.mjs). Not linked
        // from any UI; built so the check can run against the real dist output
        // instead of a hand-rolled page that could drift from production.
        clickable: path.resolve(__dirname, 'clickable.html'),
      },
    },
  },
  server: {
    // 5273 instead of vite's default 5173: locally the maintainer often has
    // another vite project holding 5173, and vite silently falls back to a
    // random high port when the default is busy, which breaks the /codex.html
    // link in dev docs. strictPort forces a hard fail if 5273 is also busy.
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7878', changeOrigin: true },
      // /mindlab-symbol.svg is NOT proxied — vite serves it from
      // web/public/. Proxying would fall through to the server's static
      // handler rooted at web/dist/, which only has the SVG after `pnpm
      // build`. In dev that's an empty miss and the SPA fallback returns
      // index.html, breaking the <img>.
    },
  },
});
