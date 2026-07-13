import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import mdx from 'fumadocs-mdx/vite';

export default defineConfig({
  plugins: [mdx(), tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  // @lobehub/icons ships ESM with extensionless relative imports (`../style`),
  // which Node's SSR resolver rejects. Let Vite bundle it so those resolve.
  ssr: {
    noExternal: ['@lobehub/icons'],
  },
});
