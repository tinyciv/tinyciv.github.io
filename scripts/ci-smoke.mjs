// Exercise the built, self-contained release. Never connect the multiplayer
// protocol check to the public server or disturb a running local game.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const output = 'output/ci-smoke';
await mkdir(output, { recursive: true });
const listener = createServer();
await new Promise((accept, reject) => {
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', accept);
});
const port = listener.address().port;
await new Promise(accept => listener.close(accept));
const endpoint = `http://127.0.0.1:${port}`;
let serverLog = '', protocolLog = '', browser;
const checks = [];
const check = message => { checks.push(message); console.log(`PASS ${message}`); };
const delay = ms => new Promise(accept => setTimeout(accept, ms));
const server = spawn(process.execPath, ['server-dist/server.mjs'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_DIR: resolve('dist'), ALLOWED_ORIGINS: endpoint },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', data => { serverLog += data; });
server.stderr.on('data', data => { serverLog += data; });
let serverFailure;
server.on('error', error => { serverFailure = error; });
const started = Date.now();
try {
  while (true) {
    if (serverFailure) throw serverFailure;
    if (server.exitCode !== null) throw Error(`Local release server exited: ${serverLog}`);
    if (Date.now() - started > 30_000) throw Error(`Local release server did not start: ${serverLog}`);
    try {
      const health = await fetch(`${endpoint}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (health.ok && (await health.json()).ok === true) break;
    } catch { /* The child has not opened its socket yet. */ }
    await delay(100);
  }
  check('Built multiplayer server starts and responds to health requests');
  for (const [path, type] of [['/', 'text/html'], ['/wasm/navigation.wasm', 'application/wasm']]) {
    const response = await fetch(endpoint + path);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type')?.includes(type), `${path} MIME type`);
  }
  check('Built frontend and navigation WASM are served with correct MIME types');

  const protocol = spawn(process.execPath, ['scripts/multiplayer-check.mjs'], {
    env: { ...process.env, MULTIPLAYER_URL: endpoint, MULTIPLAYER_ORIGIN: endpoint },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  protocol.stdout.on('data', data => { protocolLog += data; process.stdout.write(data); });
  protocol.stderr.on('data', data => { protocolLog += data; process.stderr.write(data); });
  await new Promise((accept, reject) => {
    const timer = setTimeout(() => { protocol.kill('SIGKILL'); reject(Error('Multiplayer smoke check exceeded five minutes')); }, 300_000);
    protocol.on('error', error => { clearTimeout(timer); reject(error); });
    protocol.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) accept();
      else reject(Error(`Multiplayer smoke check failed (${code ?? signal})`));
    });
  });
  check('Two-player protocol, authoritative simulation, reconnect, and cleanup pass');

  browser = await chromium.launch({
    headless: true, args: ['--enable-unsafe-swiftshader'],
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [], failedAssets = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('response', response => {
      if (response.url().startsWith(endpoint) && response.status() >= 400) {
        failedAssets.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    await page.goto(endpoint, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready', undefined, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Single player', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Multiplayer', exact: true }).waitFor();
    await page.screenshot({ path: `${output}/menu-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Single player', exact: true }).click();
    await page.locator('[name="seed"]').waitFor();
    assert.deepEqual(errors, [], 'Browser runtime errors');
    assert.deepEqual(failedAssets, [], 'Missing production assets');
    check(`Production UI loads assets and opens world creation at ${viewport.width}×${viewport.height}`);
    await page.close();
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    const deadline = Date.now() + 5000;
    while (server.exitCode === null && Date.now() < deadline) await delay(50);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await Promise.all([
    writeFile(`${output}/server.log`, serverLog),
    writeFile(`${output}/multiplayer.log`, protocolLog),
    writeFile(`${output}/checks.json`, JSON.stringify({ checks }, null, 2) + '\n'),
  ]);
}
