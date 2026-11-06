import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Vite settings tuned for Tauri: fixed port, no browser auto-open, no host exposure.
// Every build gets its own id (GitHub run number or build time): the app uses it to start
// each new test build with an empty project list (see RESET_PROJECTS_ON_NEW_BUILD in src/config.ts).
const BUILD_ID = process.env.GITHUB_RUN_ID || String(Date.now());
// Sequential number of the build: the release tag is build-<number>, the update check compares it.
const BUILD_NUM = process.env.GITHUB_RUN_NUMBER || '0';
// App version (package.json; the workflow sets it to 1.0.<build number> so the updater can compare).
// What is new in this build: RELEASE_NOTES.md at the repository root (also the GitHub release text).
let RELEASE_NOTES = '';
try { RELEASE_NOTES = readFileSync(new URL('../RELEASE_NOTES.md', import.meta.url), 'utf8').trim(); } catch { /* no notes */ }
const APP_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __BUILD_NUM__: JSON.stringify(BUILD_NUM), __APP_VERSION__: JSON.stringify(APP_VERSION), __RELEASE_NOTES__: JSON.stringify(RELEASE_NOTES) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: ['es2021', 'chrome105', 'safari15'],
    sourcemap: false,
    chunkSizeWarningLimit: 1500
  }
});
