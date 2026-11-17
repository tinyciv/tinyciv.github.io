import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshots = join(root, 'output/frozen');
mkdirSync(snapshots, { recursive: true });
// Every invocation owns its files, including public assets and the WASM core.
// Neither ordinary builds nor another frozen invocation can replace them.
const directory = mkdtempSync(join(snapshots, 'session-'));
process.once('exit', () => rmSync(directory, { recursive: true, force: true }));

const npm = process.env.npm_execpath;
const build = spawnSync(npm ? process.execPath : 'npm', [
  ...(npm ? [npm] : []), 'run', 'build', '--', '--outDir', directory,
], { cwd: root, stdio: 'inherit' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? (build.signal === 'SIGINT' ? 130 : 1));

const server = await preview({
  root,
  configFile: false,
  build: { outDir: directory },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, open: false },
});
console.log('\nFrozen game: source edits and normal builds will not update this session.');
console.log('Press Ctrl+C to stop. Run npm run frozen again to build the latest code.');
server.printUrls();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
