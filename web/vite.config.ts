import { defineConfig } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  resolve: {
    alias: {
      // Used by the vendored Macaron source (source.tsx, components/ui/*).
      // Points to /web/src/macaron-vendor — swap to the published npm package
      // (likely `@macaron/ui`) when Mindverse releases one and delete the vendor dir.
      '@': path.resolve(__dirname, 'src/macaron-vendor'),
    },
  },
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    commonjsOptions: { transformMixedEsModules: true },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7878', changeOrigin: true },
      '/mindlab-symbol.svg': { target: 'http://127.0.0.1:7878', changeOrigin: true },
    },
  },
});
