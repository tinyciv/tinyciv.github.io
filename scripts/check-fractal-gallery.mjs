import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const output = 'scratch/2026-10-30-fractal-review'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, acceptDownloads: true });
const errors = [], network = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); };
const waitWorld = () => page.waitForFunction(() => !!window.__fractalGallery.world && document.querySelector('#view-loading').hidden, null, { timeout: 60000 });
try {
  const start = Date.now(); await page.goto(pathToFileURL(resolve('output/fractal-generation-gallery.html')).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 20000 });
  check('all 25 precomputed samples open immediately', await page.locator('.sample').count() === 25, { readyMs: Date.now() - start });
  const records = await page.evaluate(() => window.__fractalGallery.records.map(({ id, seed, parameters, preview, summary, capitals, secondary }) => ({ id, seed, parameters, imageLength: preview.length, summary, capitals: capitals.length, secondary: secondary.length })));
  check('25 unique configurations share one comparison seed', new Set(records.map(r => JSON.stringify(r.parameters))).size === 25 && new Set(records.map(r => r.seed)).size === 1);
  check('every sample contains all 39 landscape settings', records.every(r => Object.keys(r.parameters).length === 39));
  check('all 25 previews differ', await page.evaluate(() => new Set(window.__fractalGallery.records.map(r => r.preview)).size === 25));
  check('all samples contain complete faction starts', records.every(r => r.capitals === 11 && r.secondary === 10), records.map(r => ({ id: r.id, minimumCapitalGap: r.summary.minimumStartDistance })));
  check('review spans actual vegetation and relief outcomes', new Set(records.map(r => Math.round(r.summary.forest * 100))).size >= 10 && new Set(records.map(r => r.summary.mountainBodies)).size >= 5);
  await page.screenshot({ path: `${output}/gallery-desktop.png`, fullPage: true });
  const firstBefore = await page.locator('.sample canvas').first().evaluate(canvas => canvas.toDataURL());
  await page.locator('#show-equator').check();
  const firstAfter = await page.locator('.sample canvas').first().evaluate(canvas => canvas.toDataURL());
  check('equator guide changes the overview', firstBefore !== firstAfter);
  await page.locator('#show-starts').uncheck();
  check('faction markers can be hidden', await page.locator('.sample canvas').first().evaluate(canvas => canvas.toDataURL()) !== firstAfter);
  await page.locator('#show-starts').check();
  await page.locator('[data-id="04"] .favorite-button').click(); await page.locator('#favorites-only').check();
  check('favorites filter retains the selected map', await page.locator('.sample:visible').count() === 1 && await page.locator('[data-id="04"]').isVisible());
  await page.locator('#favorites-only').uncheck(); await page.locator('[data-id="04"] .favorite-button').click();
  await page.locator('[data-id="01"] .open-map').click(); await waitWorld();
  const worldInfo = await page.evaluate(() => { const g = window.__fractalGallery; return { style: g.world.generationStyle, sameSeed: g.world.seed === g.selected.seed, storedParameters: JSON.stringify(g.world.generationParameters) === JSON.stringify(g.selected.parameters), settings: document.querySelectorAll('.setting').length }; });
  check('selected map uses its exact production configuration', worldInfo.style === 'fractal' && worldInfo.sameSeed && worldInfo.storedParameters && worldInfo.settings === 39, worldInfo);
  const zoom = await page.evaluate(() => window.__fractalGallery.zoom); await page.locator('#zoom-in').click();
  check('detail zoom changes terrain scale', await page.evaluate(() => window.__fractalGallery.zoom) > zoom);
  await page.locator('#find-mountains').click(); await page.waitForTimeout(100);
  const mountain = await page.evaluate(() => { const { world, center } = window.__fractalGallery; return { tag: document.querySelector('#view-tag').textContent, nearby: world.tiles.some((tile, i) => tile.ridge && tile.relief === 'mountains' && Math.hypot(i % world.width - center.x, Math.floor(i / world.width) - center.y) < 12) }; });
  check('mountain jump visits a measured mountain body', mountain.nearby && mountain.tag.startsWith('Mountain 1/'), mountain);
  const firstMountain = await page.evaluate(() => ({ ...window.__fractalGallery.center }));
  await page.locator('#find-mountains').click(); await page.waitForTimeout(60);
  check('mountain button cycles to a different shape and length', await page.evaluate(before => Math.hypot(window.__fractalGallery.center.x - before.x, window.__fractalGallery.center.y - before.y) > 1 && document.querySelector('#view-tag').textContent.startsWith('Mountain 2/'), firstMountain));
  await page.locator('#show-grid').check(); await page.waitForTimeout(60); await page.screenshot({ path: `${output}/gallery-detail.png` });
  const box = await page.locator('#detail').boundingBox(), beforeCenter = await page.evaluate(() => ({ ...window.__fractalGallery.center }));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 35, { steps: 5 }); await page.mouse.up();
  check('dragging pans the detail map', await page.evaluate(before => Math.abs(window.__fractalGallery.center.x - before.x) > 1, beforeCenter));
  check('tile inspector reports location and terrain', /\d+, \d+/.test(await page.locator('#tile-info').textContent()));
  const downloadPromise = page.waitForEvent('download'); await page.locator('#download').click(); const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  check('download includes the exact seed and settings', exported.style === 'fractal' && exported.seed === records[0].seed && JSON.stringify(exported.parameters) === JSON.stringify(records[0].parameters));
  await page.keyboard.press('Escape'); check('escape closes the inspector', !(await page.locator('#inspector').evaluate(dialog => dialog.open)));
  await page.locator('#import-file').setInputFiles({ name: 'sample.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) }); await waitWorld();
  check('import reproduces the exported sample', await page.evaluate(p => JSON.stringify(window.__fractalGallery.world.generationParameters) === JSON.stringify(p), exported.parameters));
  await page.locator('#close').click();
  const showcaseIds = ['mountainClumpShare', 'mountainStringShare'].map(key => records.toSorted((a, b) => b.parameters[key] - a.parameters[key])[0].id);
  for (let n = 0; n < showcaseIds.length; n++) {
    await page.locator(`[data-id="${showcaseIds[n]}"] .open-map`).click(); await waitWorld(); await page.locator('#find-mountains').click(); if (!n) await page.locator('#find-mountains').click(); await page.locator('#show-grid').uncheck(); await page.waitForTimeout(100);
    await page.screenshot({ path: `${output}/gallery-${n ? 'strings' : 'clumps'}.png` }); await page.locator('#close').click();
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
  check('mobile gallery has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/gallery-mobile.png`, fullPage: true });
  await page.locator('[data-id="25"] .open-map').click(); await waitWorld();
  check('mobile inspector stays within the viewport', await page.locator('#inspector').evaluate(dialog => dialog.getBoundingClientRect().right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth));
  await page.screenshot({ path: `${output}/gallery-mobile-detail.png` }); await page.locator('#close').click();
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.locator('#seed').fill('FRACTAL-GALLERY-CHECK'); await page.locator('#regenerate').click();
  const deadline = Date.now() + 180000; let previousCount = -1;
  while (Date.now() < deadline) {
    const progress = await page.evaluate(() => ({ ready: document.documentElement.dataset.ready, count: window.__fractalGallery.records.length, error: document.querySelector('#status').classList.contains('error'), status: document.querySelector('#status').textContent }));
    if (progress.count !== previousCount) { console.log(`Regeneration: ${progress.count}/25`); previousCount = progress.count; }
    assert.ok(!progress.error, progress.status);
    if (progress.ready === 'true' && progress.count === 25) break;
    await page.waitForTimeout(1000);
  }
  check('regeneration makes 25 new seeded parameter samples', await page.evaluate(() => window.__fractalGallery.records.every(r => r.seed === 'FRACTAL-GALLERY-CHECK') && new Set(window.__fractalGallery.records.map(r => JSON.stringify(r.parameters))).size === 25));
  check('standalone makes no network requests', network.length === 0, network);
  check('no browser runtime errors', errors.length === 0, errors);
} finally {
  await writeFile(`${output}/gallery-checks.json`, JSON.stringify({ checks, errors, network }, null, 2)); console.log(JSON.stringify({ checks, errors, network }, null, 2)); await browser.close();
}
