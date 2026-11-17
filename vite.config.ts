import { defineConfig } from 'vite';

export default defineConfig({
  // Historical art galleries and scratch reviews can reference retired modules.
  // Only maintained entry points participate in dependency pre-bundling.
  optimizeDeps: { entries: ['index.html', 'world.html'] },
  build: { rollupOptions: { input: { game: 'index.html', world: 'world.html' } } },
});
