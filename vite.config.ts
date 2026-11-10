import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  // Never let an optimisation step touch the GLB/WebP assets: they're served as-is from /public.
  assetsInclude: ['**/*.glb'],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
