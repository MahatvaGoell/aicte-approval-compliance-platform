import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    // Same origin for the browser: /api is forwarded to the API server, so session cookies stay first-party.
    proxy: { '/api': 'http://127.0.0.1:4000', '/health': 'http://127.0.0.1:4000' },
  },
});
