import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev proxy — API calls from frontend go to backend without CORS friction
      '/incidents': 'http://localhost:3000',
      '/analysis': 'http://localhost:3000',
      '/context': 'http://localhost:3000',
      '/audit': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true }
    }
  }
});
