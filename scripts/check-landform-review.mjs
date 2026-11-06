import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const output = 'scratch/2026-10-30-landforms';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, acceptDownloads: true });
const checks = [], errors = [], network = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); };
const waitDraw = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const waitWorld = async () => { await page.waitForFunction(() => !!window.__landformReview.world && document.querySelector('#view-loading').hidden, null, { timeout: 30000 }); await waitDraw(); };
const canvasData = () => page.locator('#detail').evaluate(canvas => canvas.toDataURL());
try {
  const began = Date.now();
  await page.goto(pathToFileURL(resolve('output/landform-world-review.html')).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 20000 });
  check('twelve precomputed worlds open directly from disk', await page.locator('.sample').count() === 12, { readyMs: Date.now() - began });
  const records = await page.evaluate(() => window.__landformReview.records.map(({ compressedWorld, previews, ...record }) => record));
  check('two seeds each compare all six landform families', new Set(records.map(r => r.seed)).size === 2 && [...new Set(records.map(r => r.seed))].every(seed => new Set(records.filter(r => r.seed === seed).map(r => r.family)).size === 6));
  check('comparison holds style and landscape settings constant', records.every(r => r.style === 'fractal') && new Set(records.map(r => JSON.stringify(r.parameters))).size === 1);
  check('each generated map has distinct terrain and height previews', await page.evaluate(() => ['terrain', 'height'].every(mode => new Set(window.__landformReview.records.map(r => r.previews[mode])).size === 12)));
  check('forest mesh holds across all families', records.every(r => r.summary.adjacentOpenGround === 1 && r.summary.solidTwoByTwo === 0), records.map(r => ({ id: r.id, woodland: r.summary.forest, gaps: r.summary.adjacentOpenGround, solidTwoByTwo: r.summary.solidTwoByTwo })));
  check('all maps supply actual province and woodland focus locations', records.every(r => r.provinces.length > 0 && r.summary.features.province.length > 0 && r.summary.woodlandFocus.length > 0));
  await page.screenshot({ path: `${output}/review-desktop.png`, fullPage: true });
  const firstTerrain = await page.locator('.sample canvas').first().evaluate(canvas => canvas.toDataURL());
  await page.locator('#overview-mode').selectOption('height');
  const firstHeight = await page.locator('.sample canvas').first().evaluate(canvas => canvas.toDataURL());
  await page.locator('#overview-mode').selectOption('provinces');
  const firstProvince = await page.locator('.sample canvas').first().evaluate(canvas => canvas.toDataURL());
  check('terrain, height and province gallery modes differ', new Set([firstTerrain, firstHeight, firstProvince]).size === 3);
  await page.locator('#overview-mode').selectOption('terrain');
  await page.locator('#show-starts').check();
  check('settlement toggle changes the previews', firstTerrain !== await page.locator('.sample canvas').first().evaluate(canvas => canvas.toDataURL()));
  await page.locator('#show-starts').uncheck();
  await page.locator('[data-id="1A"] .favorite-button').click();
  const shortlistDownload = page.waitForEvent('download'); await page.locator('#download-shortlist').click();
  const shortlist = JSON.parse(await readFile(await (await shortlistDownload).path(), 'utf8'));
  check('favorites export includes family and seed', shortlist.length === 1 && shortlist[0].id === '1A' && shortlist[0].landformFamily === records[0].family && shortlist[0].seed === records[0].seed);
  for (const record of records) {
    await page.locator(`[data-id="${record.id}"] .feature-jump`).click(); await waitWorld();
    const info = await page.evaluate(() => {
      const { selected, world, zoom, center, focus } = window.__landformReview;
      const tile = world.tiles[Math.floor(focus.y) * world.width + Math.floor(focus.x)];
      const box = document.querySelector('#detail').getBoundingClientRect();
      const focusValid = Object.values(selected.summary.features).flat().some(feature => feature.x === focus.x && feature.y === focus.y)
        && Math.abs(focus.x - center.x) * zoom <= box.width / 2 && Math.abs(focus.y - center.y) * zoom <= box.height / 2;
      return { matching: world.seed === selected.seed && world.generationStyle === selected.style && world.landformFamily === selected.family && JSON.stringify(world.generationParameters) === JSON.stringify(selected.parameters), countMatches: selected.capitals.length === world.spawns.length && selected.secondary.length === (world.secondarySpawns ?? []).length, dimensions: world.tiles.length === selected.width * selected.height, native: document.querySelector('#view-tag').textContent.includes('Native terrain'), zoom, focusValid, terrain: tile?.terrain, facts: document.querySelector('#map-facts').textContent };
    });
    check(`${record.id} opens the exact family snapshot at a measured native feature`, info.matching && info.countMatches && info.dimensions && info.native && info.zoom === 16 && info.focusValid, info);
    if (record.id.endsWith('A')) await page.screenshot({ path: `${output}/landform-${record.id}-${record.family}.png` });
    await page.locator('#close').click();
  }
  await page.locator('[data-id="2A"] .feature-jump').click(); await waitWorld();
  await page.locator('#fit').click(); await waitDraw();
  await page.locator('#detail-mode').selectOption('height'); await waitDraw();
  check('height inspector uses the selected diagnostic mode', await page.evaluate(() => window.__landformReview.mode === 'height') && /Continuous elevation/.test(await page.locator('#view-tag').textContent()));
  await page.screenshot({ path: `${output}/review-height.png` });
  const heightData = await canvasData();
  await page.locator('#detail-mode').selectOption('provinces'); await waitDraw();
  check('province inspector changes the map and synchronizes gallery mode', await canvasData() !== heightData && await page.locator('#overview-mode').inputValue() === 'provinces');
  await page.screenshot({ path: `${output}/review-provinces.png` });
  await page.locator('#detail-mode').selectOption('terrain'); await waitDraw();
  await page.locator('#find-province').click(); await waitDraw();
  const firstProvinceCenter = await page.evaluate(() => ({ ...window.__landformReview.center }));
  await page.locator('#find-province').click(); await waitDraw();
  const provinceCount = records.find(r => r.id === '2A').summary.features.province.length;
  check('province jump cycles through available regions', provinceCount === 1 || await page.evaluate(before => Math.hypot(window.__landformReview.center.x - before.x, window.__landformReview.center.y - before.y) > 0, firstProvinceCenter));
  for (const kind of ['river', 'lake']) {
    if (await page.locator(`#find-${kind}`).isDisabled()) continue;
    await page.locator(`#find-${kind}`).click(); await waitDraw();
    check(`${kind} jump lands on actual ${kind} terrain`, await page.evaluate(kind => { const { world, focus } = window.__landformReview; return world.tiles[Math.floor(focus.y) * world.width + Math.floor(focus.x)].terrain === kind; }, kind));
  }
  await page.locator('#find-forest').click(); await waitDraw();
  const withTrees = await canvasData(); await page.locator('#show-woodland').uncheck(); await waitDraw();
  check('trees can be hidden to expose terrain', await canvasData() !== withTrees);
  await page.locator('#show-woodland').check(); await waitDraw();
  const withoutGrid = await canvasData(); await page.locator('#show-grid').check(); await waitDraw();
  check('grid changes the native view', await canvasData() !== withoutGrid);
  await page.screenshot({ path: `${output}/review-woodland.png` });
  await page.locator('#show-grid').uncheck();
  await page.locator('#native-scale').click(); await waitDraw();
  check('native scale switches to exact 1x', await page.evaluate(() => window.__landformReview.zoom === 16));
  await page.locator('#native-scale').click(); await waitDraw();
  check('native scale switches to exact 2x', await page.evaluate(() => window.__landformReview.zoom === 32));
  const box = await page.locator('#detail').boundingBox(), beforePan = await page.evaluate(() => ({ ...window.__landformReview.center }));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 35, { steps: 5 }); await page.mouse.up(); await waitDraw();
  check('drag pans and updates tile inspector', await page.evaluate(before => Math.abs(window.__landformReview.center.x - before.x) > 1, beforePan) && /\d+, \d+/.test(await page.locator('#tile-info').textContent()));
  const zoom = await page.evaluate(() => window.__landformReview.zoom); await page.locator('#zoom-in').click(); await waitDraw();
  check('zoom control changes map scale', await page.evaluate(() => window.__landformReview.zoom) > zoom);
  const detailDownload = page.waitForEvent('download'); await page.locator('#download').click();
  const exported = JSON.parse(await readFile(await (await detailDownload).path(), 'utf8')), selectedRecord = records.find(r => r.id === '2A');
  check('settings export includes exact family, seed, parameters and measurements', exported.seed === selectedRecord.seed && exported.landformFamily === selectedRecord.family && JSON.stringify(exported.parameters) === JSON.stringify(selectedRecord.parameters) && exported.summary.adjacentOpenGround === 1);
  await page.keyboard.press('Escape'); check('escape closes inspector', !(await page.locator('#inspector').evaluate(dialog => dialog.open)));
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
  check('mobile gallery has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/review-mobile.png`, fullPage: true });
  await page.locator('[data-id="3B"] .feature-jump').click(); await waitWorld();
  check('mobile inspector has no horizontal overflow', await page.locator('#inspector').evaluate(dialog => dialog.getBoundingClientRect().right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth));
  await page.screenshot({ path: `${output}/review-mobile-detail.png` });
  check('standalone makes no network requests', network.length === 0, network);
  check('no browser runtime errors', errors.length === 0, errors);
} finally {
  const result = { checks, errors, network }; await writeFile(`${output}/review-checks.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify({ passed: checks.filter(check => check.pass).length, total: checks.length, errors, network }, null, 2)); await browser.close();
}
