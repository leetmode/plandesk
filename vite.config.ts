import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { environment: 'node' },
});
