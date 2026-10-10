// Builds ONE self-contained HTML file with a simulated server, for sharing a clickable preview.
// Run from the repo root: npm run build:preview
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: dir,
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      'socket.io-client': path.join(dir, 'preview/mock-socket.js'),
      'node:crypto': path.join(dir, 'preview/crypto-shim.js')
    }
  },
  build: { outDir: path.join(dir, '../preview-dist'), emptyOutDir: true, rollupOptions: { input: path.join(dir, 'preview.html') } }
});
