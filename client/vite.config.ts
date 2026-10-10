import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The deployed site lives at the root of its custom domain, like dev does.
  // VITE_BASE only has to be set for a github.io project site, at /<repo>/.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Keeps the browser on one origin in dev, so no CORS round trips.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
