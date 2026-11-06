import { defineConfig } from 'vite';

export default defineConfig({
  // Historical art galleries and scratch reviews can reference retired modules.
  // Only the game's entry point participates in dependency pre-bundling.
  optimizeDeps: { entries: ['index.html'] },
});
