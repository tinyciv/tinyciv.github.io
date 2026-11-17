// Headless check: node stories/check-stories.mjs  (env: STORYBOOK_URL, STORIES=id1,id2, CHECK_OUT)
// Loads each story iframe, waits for data-ready, reads back the WebGL frame and fails on console/HTTP errors.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const base = process.env.STORYBOOK_URL || 'http://127.0.0.1:6006';
const out = process.env.CHECK_OUT || 'scratch/2026-11-11-storybook';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
  (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
const stories = process.env.STORIES ? process.env.STORIES.split(',')
  : Object.values((await (await fetch(`${base}/index.json`)).json()).entries).filter(entry => entry.type === 'story').map(entry => entry.id);
const report = [];
let failed = false;
for (const id of stories) {
  const page = await browser.newPage({ viewport: { width: 1320, height: 880 } });
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()} ${message.location()?.url ?? ''}`); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`http ${response.status()} ${response.url()}`); });
  const started = Date.now();
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'load' });
  await page.waitForSelector('.tc-gallery[data-ready], .tc-scenario[data-ready], .tc-loading[data-error]', { timeout: 120000 });
  const gallery = await page.evaluate(() => !!document.querySelector('.tc-gallery') && !document.querySelector('.tc-scenario, .tc-loading'));
  await page.waitForTimeout(600);
  const result = await page.evaluate(async gallery => {
    if (gallery) return { canvases: document.querySelectorAll('.tc-gallery canvas').length, labels: [...document.querySelectorAll('.tc-gallery-label')].map(l => l.textContent), missing: document.querySelectorAll('.tc-gallery-missing').length };
    const error = document.querySelector('.tc-loading[data-error]')?.textContent;
    if (error) return { error };
    const scenario = window.__scenario, snap = scenario.snapshot();
    const data = snap.getContext('2d').getImageData(0, 0, snap.width, snap.height).data;
    const colors = new Set(); let nonBlack = 0;
    for (let i = 0; i < data.length; i += 4 * 7) { const r = data[i], g = data[i + 1], b = data[i + 2]; if (r + g + b > 24) nonBlack++; colors.add((r >> 3) << 10 | (g >> 3) << 5 | b >> 3); }
    const s = scenario.state, soldiers = s.units.filter(u => u.hp > 0 && ['warrior','spearman','archer','swordsman','horseman','leader'].includes(u.kind));
    return { size: [snap.width, snap.height], nonBlackFraction: +(nonBlack / (data.length / 28)).toFixed(3), distinctColors: colors.size,
      time: +s.time.toFixed(2), zoom: scenario.renderer.zoom, camera: scenario.renderer.camera, backend: scenario.renderer.backend,
      stats: scenario.renderer.renderStats, hurt: soldiers.filter(u => u.hp < (u.maxHp ?? 100)).length, projectiles: s.projectiles.length,
      walls: s.buildings.filter(b => b.kind === 'wall' && b.faction === 0).length, wallSites: s.buildings.filter(b => b.kind === 'wall' && b.construction).length,
      workersOut: s.units.filter(u => u.faction === 0 && u.kind === 'worker' && !u.inside).length };
  }, gallery);
  await page.screenshot({ path: `${out}/${id}.png` });
  if (!gallery && !result.error) {
    // Exercise the play control: the real simulation advances, the frame changes.
    await page.click('[data-control="play"]'); await page.waitForTimeout(1500); await page.click('[data-control="play"]');
    result.afterPlay = await page.evaluate(() => +window.__scenario.state.time.toFixed(2));
    await page.screenshot({ path: `${out}/${id}-after-play.png` });
  }
  const ok = !errors.length && (gallery ? result.canvases > 0 && !result.missing : !result.error && result.nonBlackFraction > .5 && result.distinctColors > 200);
  failed ||= !ok;
  report.push({ id, ok, ms: Date.now() - started, result, errors });
  console.log(ok ? 'PASS' : 'FAIL', id, JSON.stringify(result), errors.slice(0, 5));
  await page.close();
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
process.exit(failed ? 1 : 0);
