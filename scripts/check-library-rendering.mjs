import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const out = arg('out', 'scratch/2026-10-30-library-integration/rendering');
const baseline = arg('baseline', 'http://127.0.0.1:5194/');
const current = arg('current', 'http://127.0.0.1:5195/');
const saved = JSON.parse(await readFile(arg('state', 'scratch/2026-10-29-live-performance/optimization/paused-live-state.json'), 'utf8'));
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
const report = { baseline, current, viewport: [1440, 900], dpr: 1, cases: [], errors: [] };
await mkdir(out, { recursive: true });
async function open(url, label) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push({ label, error: String(error) }));
  await page.addInitScript(() => {
    window.__renderCheckRAF = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', null, { polling: 50, timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } #world { visibility: visible !important; }' });
  return page;
}
try {
  const before = await open(baseline, 'baseline');
  const cases = await before.evaluate(async saved => {
    const { createPerformanceScenario } = await import('/dev/performance/scenarios.ts');
    const { updateGame, createGame } = await import('/src/game/simulation.ts');
    const { generateWorld } = await import('/src/world/generator.ts');
    const cases = [];
    for (const id of ['idle-600', 'combat-600']) {
      const scene = createPerformanceScenario(id);
      for (let i = 0; i < 60; i++) updateGame(scene.state, 1 / 60, { up: false, down: false, left: false, right: false });
      cases.push({ id, state: scene.state, camera: scene.camera, zoom: scene.zoom });
    }
    const leader = saved.units.find(u => u.kind === 'leader' && u.faction === 0);
    for (const zoom of [.65, 1.35, 2]) cases.push({ id: `settlement-${zoom}`, state: saved, camera: { x: leader.x, y: leader.y }, zoom });
    const state = createGame(generateWorld('library-rendering-reference'));
    const player = state.units.find(u => u.kind === 'leader' && u.faction === 0);
    cases.push({ id: 'new-world', state, camera: { x: player.x, y: player.y }, zoom: 1 });
    return cases;
  }, saved);
  const after = await open(current, 'current');
  for (const scene of cases) {
    const result = { id: scene.id, zoom: scene.zoom };
    const screenshots = [];
    for (const [label, page] of [['baseline', before], ['current', after]]) {
      result[label] = await page.evaluate(async scene => {
        const r = __game.renderer;
        let s = scene.state;
        if (__game.replaceState) __game.replaceState(s);
        else { const live = __game.state; for (const key of Object.keys(live)) delete live[key]; Object.assign(live, s); s = live; }
        s.paused = true;
        r.camera = scene.camera; r.zoom = scene.zoom; r.follow = false;
        r.hover = null; r.buildPreview = []; r.areaPreview = null;
        for (let i = 0; i < 5; i++) r.draw(s, 0);
        for (let i = 0; i < 2; i++) await new Promise(resolve => __renderCheckRAF(() => { r.draw(s, 0); resolve(); }));
        return { units: s.units.length, buildings: s.buildings.length, time: s.time,
          backend: r.backend ?? r.renderBackend ?? 'canvas', stats: r.renderStats ?? r.stats ?? null,
          canvas: [r.canvas.width, r.canvas.height] };
      }, scene);
      const screenshot = await page.locator('#world').screenshot({ path: path.join(out, `${scene.id}-${label}.png`) });
      screenshots.push(`data:image/png;base64,${screenshot.toString('base64')}`);
    }
    result.comparison = await before.evaluate(async images => {
      const data = await Promise.all(images.map(async url => {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      }));
      let error = 0, changed = 0;
      for (let i = 0; i < data[0].length; i += 4) {
        let different = false;
        for (let c = 0; c < 3; c++) {
          const delta = Math.abs(data[0][i + c] - data[1][i + c]); error += delta;
          different ||= delta > 32;
        }
        if (different) changed++;
      }
      return { meanChannelError: error / (data[0].length / 4 * 3), changedFraction: changed / (data[0].length / 4) };
    }, screenshots);
    // Fractional nearest-neighbor sampling can shift edge pixels between Canvas
    // and WebGL. Reject broad differences, and assert that GPU drawing is real.
    result.pass = result.current.backend === 'pixi-webgl' && result.current.stats?.directImages > 0
      && result.comparison.meanChannelError < 1 && result.comparison.changedFraction < .02;
    report.cases.push(result);
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`Captured ${scene.id}`);
  }
  report.pass = report.errors.length === 0 && report.cases.every(scene => scene.pass);
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (!report.pass) throw new Error(`Rendering check failed; inspect ${out}/report.json`);
} finally { await browser.close(); }
