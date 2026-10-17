import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The backend (make api) listens on 127.0.0.1:8000; proxying avoids CORS in dev.
const backend = process.env.GHOST_API ?? 'http://127.0.0.1:8000';

/** The data team's sample evidence, served from ../data without copying it into ui/. */
const SAMPLES: Record<string, [string, string]> = {
  'reefer_truck.jpg': ['photos/reefer_truck.jpg', 'image/jpeg'],
  'breakdown.wav': ['audio/breakdown.wav', 'audio/wav'],
  'breakdown.txt': ['audio/breakdown.txt', 'text/plain; charset=utf-8'],
};
const DATA_DIR = resolve(__dirname, '../data');

const serveSamples: Connect.NextHandleFunction = (req, res, next) => {
  const name = (req.url ?? '').replace(/^\//, '').split('?')[0];
  const entry = SAMPLES[name];
  const file = entry && resolve(DATA_DIR, entry[0]);
  if (!entry || !file || !existsSync(file)) return next();
  res.setHeader('Content-Type', entry[1]);
  res.setHeader('Content-Length', statSync(file).size);
  createReadStream(file).pipe(res);
};

const samples = (): Plugin => ({
  name: 'ghost-samples',
  configureServer: (server) => void server.middlewares.use('/samples', serveSamples),
  configurePreviewServer: (server) => void server.middlewares.use('/samples', serveSamples),
});

export default defineConfig({
  plugins: [react(), samples()],
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
