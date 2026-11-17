import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/html-vite';
import type { Plugin } from 'vite';

const repository = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// Only image files in these repository folders are exposed under /@repo/.
// Never widen this to the repository root: .env.local holds credentials.
const REPO_ASSET_FOLDERS = ['scratch', 'public', 'docs', 'output'];
const REPO_ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
};

/** Dev-server route for gallery previews of generated art (see stories/README.md). */
function repoAssets(): Plugin {
  return {
    name: 'tinyciv-storybook-repo-assets',
    configureServer(server) {
      server.middlewares.use('/@repo/', (request, response, next) => {
        const relative = decodeURIComponent((request.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const file = resolve(repository, relative), type = REPO_ASSET_TYPES[extname(file).toLowerCase()];
        const allowed = type && REPO_ASSET_FOLDERS.some(folder => file.startsWith(resolve(repository, folder) + sep));
        if (!allowed) { response.statusCode = 404; response.end(); return; }
        try { if (!statSync(file).isFile()) throw new Error('not a file'); }
        catch { next(); return; }
        response.setHeader('Content-Type', type);
        response.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(response);
      });
    },
  };
}

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(ts|js)'],
  framework: { name: '@storybook/html-vite', options: {} },
  // The game fetches /wasm/simulation.wasm, /assets/... exactly as in the app.
  staticDirs: ['../public'],
  core: { disableTelemetry: true },
  async viteFinal(viteConfig) {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), repoAssets()];
    // Other tools write thousands of review files; they must not reload stories.
    const ignored = ['**/scratch/**', '**/output/**', '**/dist/**', '**/storybook-static/**', '**/rust/target/**', '**/server-dist/**'];
    const previous = viteConfig.server?.watch?.ignored;
    viteConfig.server = { ...viteConfig.server, watch: { ...viteConfig.server?.watch,
      ignored: [...(Array.isArray(previous) ? previous : previous ? [previous] : []), ...ignored] } };
    // src/game/rust-engine.ts uses top-level await to instantiate the core.
    viteConfig.build = { ...viteConfig.build, target: 'esnext', chunkSizeWarningLimit: 8192 };
    viteConfig.optimizeDeps = { ...viteConfig.optimizeDeps, esbuildOptions: { ...viteConfig.optimizeDeps?.esbuildOptions, target: 'esnext' } };
    return viteConfig;
  },
};
export default config;
