import { defineConfig } from 'vite';

export default defineConfig({
  define: { 'import.meta.env.VITE_BUILD_VERSION': JSON.stringify(process.env.VITE_BUILD_VERSION || process.env.GITHUB_SHA?.slice(0, 12) || process.env.npm_package_version || '0.1.0') },
  // Historical art galleries and scratch reviews can reference retired modules.
  // Only maintained entry points participate in dependency pre-bundling.
  optimizeDeps: { entries: ['index.html', 'world.html', 'analytics.html'] },
  build: { rollupOptions: { input: { game: 'index.html', world: 'world.html', analytics: 'analytics.html' } } },
});
