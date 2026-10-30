import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite settings tuned for Tauri: fixed port, no browser auto-open, no host exposure.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: ['es2021', 'chrome105', 'safari15'],
    sourcemap: false,
    chunkSizeWarningLimit: 1500
  }
});
