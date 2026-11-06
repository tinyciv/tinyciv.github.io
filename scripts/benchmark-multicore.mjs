import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';

const arg = (key, fallback) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const out = arg('out', 'scratch/2026-10-30-multicore'), url = arg('url', 'http://127.0.0.1:5187/');
const seconds = Number(arg('seconds', '10')), frames = Number(arg('frames', '60'));
const scenes = arg('scenes', 'combat-600,settlement').split(',');
const phases = arg('phases', 'parity,transport,frames').split(',');
const saved = JSON.parse(await readFile(arg('state', 'scratch/2026-10-29-live-performance/optimization/paused-live-state.json'), 'utf8'));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const report = { environment: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, browser: await browser.version(),
  url, viewport: [1440, 900], seconds, frames }, results: [], errors: [] };
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', error => report.errors.push(String(error)));
await page.addInitScript(() => {
  window.__nativeRAF = requestAnimationFrame.bind(window);
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};
});
const save = async () => writeFile(`${out}/${arg('label', 'worker-experiment')}.json`, JSON.stringify(report, null, 2));
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', null, { polling: 50 });
  await page.evaluate(async saved => {
    const lab = await import('/dev/multicore-lab/client.ts'), fixtures = await import('/dev/performance/scenarios.ts');
    window.__multicore = { lab, fixtures, saved };
    window.__multicore.source = name => {
      const source = name === 'settlement' ? structuredClone(saved) : fixtures.createPerformanceScenario(name).state;
      source.paused = false;
      return source;
    };
    window.__multicore.position = (name, state) => {
      const renderer = window.__game.renderer; renderer.follow = false; renderer.hover = null; renderer.buildPreview = [];
      if (name === 'settlement') renderer.center(state);
      else { const fixture = fixtures.createPerformanceScenario(name); renderer.camera = fixture.camera; renderer.zoom = fixture.zoom; }
    };
  }, saved);
  report.environment.capabilities = await page.evaluate(() => ({ hardwareConcurrency: navigator.hardwareConcurrency,
    crossOriginIsolated, sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined', offscreenCanvas: typeof OffscreenCanvas !== 'undefined', worker: typeof Worker !== 'undefined' }));
  for (const scene of scenes) {
    if (phases.includes('parity')) {
      const result = await page.evaluate(async scene => __multicore.lab.parity(__multicore.source(scene), 90), scene);
      report.results.push({ scene, phase: 'parity', ...result }); await save();
      console.log(`${scene} exact-state parity: ${result.equal}`);
      if (!result.equal) throw new Error(`${scene}: worker and main simulation diverged`);
    }
    if (phases.includes('transport')) for (const mode of ['none','full','dynamic','packed']) {
      const result = await page.evaluate(async ({ scene, mode, frames }) => __multicore.lab.transport(__multicore.source(scene), mode, frames), { scene, mode, frames });
      report.results.push({ scene, phase: 'transport', ...result }); await save();
      console.log(`${scene}/${mode}: round-trip p95 ${result.metrics.roundTrip.p95.toFixed(2)}ms; noncompute ${result.metrics.other.p95.toFixed(2)}ms`);
    }
    if (phases.includes('frames')) for (const mode of ['main','worker']) {
      const result = await page.evaluate(async ({ scene, mode, seconds }) => {
        const state = __multicore.source(scene); __multicore.position(scene, state);
        return __multicore.lab.frameExperiment(state, __game.renderer, __nativeRAF, mode, seconds);
      }, { scene, mode, seconds });
      report.results.push({ scene, phase: 'frames', ...result }); await save();
      console.log(`${scene}/${mode}: ${result.fps.toFixed(1)}fps; main work p95 ${result.metrics.work.p95.toFixed(2)}ms; updates ${result.simulationHz.toFixed(1)}Hz; game speed ${result.achievedSpeed.toFixed(2)}x`);
      await page.screenshot({ path: `${out}/${scene}-${mode}.png` });
    }
  }
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  report.pass = true; await save();
} catch (error) { report.failure = String(error); await save(); throw error; }
finally { await browser.close(); }
