import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend (make api) listens on 127.0.0.1:8000; proxying avoids CORS in dev.
const backend = process.env.GHOST_API ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': backend, '/health': backend },
  },
  preview: {
    port: 4173,
    proxy: { '/api': backend, '/health': backend },
  },
});
