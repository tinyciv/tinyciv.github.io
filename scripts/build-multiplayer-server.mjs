import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('server-dist', { recursive: true });
await build({ entryPoints: ['server/server.ts', 'server/match-worker.ts', 'server/accounts-admin.ts'], outdir: 'server-dist', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: false,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false' }, });
await copyFile('public/wasm/simulation.wasm', 'server-dist/simulation.wasm');
await copyFile('server/rds-ca.pem', 'server-dist/rds-ca.pem');
console.log('Built standalone multiplayer server and match worker.');
