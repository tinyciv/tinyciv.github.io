// Headless check for the village evolution stories.
//   node stories/village-evolution/check.mjs
// env: STORYBOOK_URL (default http://127.0.0.1:6006), STORIES=id1,id2, CHECK_OUT, CONCURRENCY (default 3)
// Loads each story iframe, waits for it to finish (one real simulation per family takes ~1 min),
// then checks: no console/page/HTTP errors; every frame non-blank; consecutive frames differ
// (> 1% of sampled pixels); stages reported by the captions; the confederation button resolves as
// expected. Saves each frame as a PNG, a full-page screenshot per story, and report.json.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.STORYBOOK_URL || 'http://127.0.0.1:6006';
const out = process.env.CHECK_OUT || 'scratch/2026-11-11-village-evolution';
const concurrency = Number(process.env.CONCURRENCY || 3);
mkdirSync(out, { recursive: true });
const ALL = ['roadside-strip', 'market-cross-strip', 'riverside-strip', 'hill-cluster-strip', 'gallery', 'live-village',
  'confederation-accepted', 'confederation-refused'].map(name => `game-village-evolution--${name}`);
const stories = process.env.STORIES ? process.env.STORIES.split(',') : ALL;
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
  (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });

async function check(id) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [], started = Date.now(), name = id.replace('game-village-evolution--', '');
  page.on('pageerror', error => errors.push(`pageerror: ${error}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`http ${response.status()} ${response.url()}`); });
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'load' });
  await page.waitForSelector('.ve-root[data-ready], .tc-scenario[data-ready], [data-error]', { timeout: 900000 });
  await page.waitForTimeout(800);
  const result = await page.evaluate(() => {
    const failed = document.querySelector('[data-error]')?.textContent;
    if (failed) return { error: failed };
    const measure = canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set(); let lit = 0, samples = 0;
      for (let i = 0; i < data.length; i += 4 * 7) { samples++; const r = data[i], g = data[i + 1], b = data[i + 2]; if (r + g + b > 24) lit++; colors.add((r >> 3) << 10 | (g >> 3) << 5 | b >> 3); }
      return { size: [canvas.width, canvas.height], nonBlackFraction: +(lit / samples).toFixed(3), distinctColors: colors.size, data };
    };
    const frames = [...document.querySelectorAll('.ve-frame')];
    if (frames.length) {
      const rows = frames.map(frame => {
        const canvas = frame.querySelector('canvas'), stats = measure(canvas);
        return { stage: Number(frame.dataset.stage), caption: [...frame.querySelectorAll('figcaption span')].map(s => s.textContent), stats, png: canvas.toDataURL('image/png') };
      });
      const diffs = rows.map((row, i) => {
        if (i % 5 === 0) return null;
        const a = rows[i - 1].stats.data, b = row.stats.data; let changed = 0, samples = 0;
        for (let p = 0; p < Math.min(a.length, b.length); p += 4 * 5) { samples++; if (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) > 30) changed++; }
        return +(changed / samples).toFixed(4);
      });
      return { frames: rows.map((row, i) => ({ stage: row.stage, caption: row.caption, size: row.stats.size, nonBlackFraction: row.stats.nonBlackFraction,
        distinctColors: row.stats.distinctColors, diffFromPrevious: diffs[i], png: row.png })) };
    }
    const scenario = window.__scenario, snap = scenario.snapshot(), stats = measure(snap);
    const shadow = document.querySelector('.ve-ui-panel-host')?.shadowRoot;
    return { size: stats.size, nonBlackFraction: stats.nonBlackFraction, distinctColors: stats.distinctColors, time: +scenario.state.time.toFixed(1),
      popup: shadow?.querySelector('#dialog-body')?.innerText, cityPanel: shadow?.querySelector('.city-loyalty-summary')?.textContent,
      cityFactors: shadow?.querySelector('.city-loyalty-factors')?.textContent,
      palaces: scenario.state.buildings.filter(b => b.kind === 'palace' && b.faction === 0 && b.hp > 0).length };
  });
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  let ok = !errors.length && !result.error;
  if (result.frames) {
    result.frames.forEach((frame, i) => {
      const family = name === 'gallery' ? ['roadside', 'market-cross', 'riverside', 'hill-cluster'][Math.floor(i / 5)] : name.replace('-strip', '');
      writeFileSync(`${out}/${name === 'gallery' ? 'gallery-' : ''}${family}-${i % 5}-stage${frame.stage}.png`, Buffer.from(frame.png.split(',')[1], 'base64'));
      delete frame.png;
      ok &&= frame.nonBlackFraction > .5 && frame.distinctColors > 150 && (frame.diffFromPrevious === null || frame.diffFromPrevious > .01);
    });
    ok &&= result.frames.length === (name === 'gallery' ? 20 : 5);
  } else if (!result.error) {
    ok &&= result.nonBlackFraction > .5 && result.distinctColors > 150;
    if (name.startsWith('confederation')) {
      ok &&= /Affiliation with you/.test(result.popup ?? '') && /Confederation: accepts at/.test(result.popup ?? '') && /^Loyalty \d+\/100/.test(result.cityPanel ?? '');
      await page.evaluate(() => document.querySelector('.ve-ui-panel-host').shadowRoot.querySelector('#village-confederate').click());
      await page.waitForTimeout(800);
      result.request = await page.evaluate(() => {
        const shadow = document.querySelector('.ve-ui-panel-host').shadowRoot;
        return { outcome: document.querySelector('.ve-root').dataset.outcome, message: shadow.querySelector('.ve-outcome:not([hidden])')?.textContent || shadow.querySelector('#war-result')?.textContent,
          palaces: window.__scenario.state.buildings.filter(b => b.kind === 'palace' && b.faction === 0 && b.hp > 0).length };
      });
      await page.screenshot({ path: `${out}/${name}-after-request.png`, fullPage: true });
      ok &&= name.endsWith('accepted') ? result.request.outcome === 'accepted' && result.request.palaces === result.palaces + 1
        : result.request.outcome === 'refused' && /refuses for now/.test(result.request.message ?? '');
    }
  }
  const row = { id, ok, seconds: Math.round((Date.now() - started) / 1000), result, errors };
  console.log(ok ? 'PASS' : 'FAIL', id, JSON.stringify({ ...result, frames: result.frames?.map(f => [f.stage, f.nonBlackFraction, f.distinctColors, f.diffFromPrevious, f.caption.join(' | ')]) }), errors.slice(0, 5));
  await page.close();
  return row;
}

const report = [], pending = [...stories];
await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
  while (pending.length) { const id = pending.shift(); report.push(await check(id).catch(error => ({ id, ok: false, errors: [String(error)] }))); }
}));
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.every(row => row.ok) ? 0 : 1);
