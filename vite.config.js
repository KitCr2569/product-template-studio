import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // Proxy remove.bg API to avoid CORS issues
      '/api/removebg': {
        target: 'https://api.remove.bg',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/removebg/, '/v1.0/removebg'),
      }
    }
  }
});
