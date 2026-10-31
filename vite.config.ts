import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite settings tuned for Tauri: fixed port, no browser auto-open, no host exposure.
// Every build gets its own id (GitHub run number or build time): the app uses it to start
// each new test build with an empty project list (see RESET_PROJECTS_ON_NEW_BUILD in src/config.ts).
const BUILD_ID = process.env.GITHUB_RUN_ID || String(Date.now());

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: ['es2021', 'chrome105', 'safari15'],
    sourcemap: false,
    chunkSizeWarningLimit: 1500
  }
});
