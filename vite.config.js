import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxies /api/anthropic → Anthropic's API, adding your key from .env
      // This avoids CORS and keeps the key out of the browser bundle
      '/api/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => '/v1/messages',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('x-api-key', process.env.VITE_ANTHROPIC_API_KEY || '');
            proxyReq.setHeader('anthropic-version', '2023-06-01');
          });
        },
      },
    },
  },
})
