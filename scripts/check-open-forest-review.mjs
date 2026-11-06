import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const output = 'scratch/2026-10-30-open-forests';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, acceptDownloads: true });
const checks = [], errors = [], network = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); };
const waitWorld = async () => {
  await page.waitForFunction(() => !!window.__forestReview.world && document.querySelector('#view-loading').hidden, null, { timeout: 30000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
const canvasData = () => page.locator('#detail').evaluate(canvas => canvas.toDataURL());
try {
  const began = Date.now();
  await page.goto(pathToFileURL(resolve('output/open-forest-world-review.html')).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 20000 });
  check('nine precomputed worlds open offline', await page.locator('.sample').count() === 9, { readyMs: Date.now() - began });
  const records = await page.evaluate(() => window.__forestReview.records.map(({ compressedWorld, preview, ...record }) => record));
  check('three seeds each compare all three styles', new Set(records.map(r => r.seed)).size === 3 && [...new Set(records.map(r => r.seed))].every(seed => new Set(records.filter(r => r.seed === seed).map(r => r.style)).size === 3));
  check('all nine maps have distinct previews', await page.evaluate(() => new Set(window.__forestReview.records.map(r => r.preview)).size === 9));
  check('every tree touches a reachable cardinal gap and no solid 2x2 block remains', records.every(r => r.summary.adjacentOpenGround === 1 && r.summary.solidTwoByTwo === 0), records.map(r => ({ id: r.id, forest: r.summary.forest, adjacentOpenGround: r.summary.adjacentOpenGround, solidTwoByTwo: r.summary.solidTwoByTwo })));
  check('every map supplies multiple dense woodland review locations', records.every(r => r.summary.woodlandFocus.length >= 3));
  await page.screenshot({ path: `${output}/review-desktop.png`, fullPage: true });
  const beforeMarkers = await page.locator('.sample canvas').first().evaluate(canvas => canvas.toDataURL());
  await page.locator('#show-starts').check();
  check('settlements can be overlaid without changing the world', beforeMarkers !== await page.locator('.sample canvas').first().evaluate(canvas => canvas.toDataURL()));
  await page.locator('#show-starts').uncheck();
  await page.locator('[data-id="A1"] .favorite-button').click();
  const shortlistDownload = page.waitForEvent('download'); await page.locator('#download-shortlist').click();
  const shortlist = JSON.parse(await readFile(await (await shortlistDownload).path(), 'utf8'));
  check('favorites download identifies the chosen seed and style', shortlist.length === 1 && shortlist[0].id === 'A1' && shortlist[0].seed === records[0].seed && shortlist[0].style === records[0].style);
  for (const record of records) {
    await page.locator(`[data-id="${record.id}"] .forest-jump`).click(); await waitWorld();
    const info = await page.evaluate(() => {
      const { selected, world, zoom } = window.__forestReview;
      return { matching: world.seed === selected.seed && world.generationStyle === selected.style && JSON.stringify(world.generationParameters) === JSON.stringify(selected.parameters), countMatches: selected.capitals.length === world.spawns.length && selected.secondary.length === (world.secondarySpawns ?? []).length, dimensions: world.tiles.length === selected.width * selected.height, native: document.querySelector('#view-tag').textContent.includes('Native terrain'), zoom, facts: document.querySelector('#map-facts').textContent };
    });
    check(`${record.id} opens its exact embedded snapshot and native forest view`, info.matching && info.countMatches && info.dimensions && info.native && info.zoom === 32, info);
    if (record.id.startsWith('A')) await page.screenshot({ path: `${output}/woodland-${record.id}-${record.style}.png` });
    await page.locator('#close').click();
  }
  await page.locator('[data-id="A1"] .forest-jump').click(); await waitWorld();
  const firstCenter = await page.evaluate(() => ({ ...window.__forestReview.center }));
  await page.locator('#find-forest').click(); await waitWorld();
  check('woodland jump cycles between dense regions', await page.evaluate(before => Math.hypot(window.__forestReview.center.x - before.x, window.__forestReview.center.y - before.y) >= 27, firstCenter));
  const withTrees = await canvasData(); await page.locator('#show-woodland').uncheck(); await waitWorld();
  check('tree toggle exposes the underlying open terrain', await canvasData() !== withTrees);
  await page.locator('#show-woodland').check(); await waitWorld();
  const withoutGrid = await canvasData(); await page.locator('#show-grid').check(); await waitWorld();
  check('tile grid changes the native view', await canvasData() !== withoutGrid);
  await page.screenshot({ path: `${output}/woodland-grid.png` });
  await page.locator('#show-grid').uncheck();
  await page.locator('#native-scale').click(); await waitWorld();
  check('native scale toggles to exact 1x', await page.evaluate(() => window.__forestReview.zoom === 16));
  await page.locator('#native-scale').click(); await waitWorld();
  check('native scale toggles to exact 2x', await page.evaluate(() => window.__forestReview.zoom === 32));
  const box = await page.locator('#detail').boundingBox(), beforePan = await page.evaluate(() => ({ ...window.__forestReview.center }));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 35, { steps: 5 }); await page.mouse.up(); await waitWorld();
  check('dragging pans the world and inspects the tile', await page.evaluate(before => Math.abs(window.__forestReview.center.x - before.x) > 1, beforePan) && /\d+, \d+/.test(await page.locator('#tile-info').textContent()));
  const zoom = await page.evaluate(() => window.__forestReview.zoom); await page.locator('#zoom-in').click(); await waitWorld();
  check('zoom control changes the terrain scale', await page.evaluate(() => window.__forestReview.zoom) > zoom);
  const detailDownload = page.waitForEvent('download'); await page.locator('#download').click();
  const exported = JSON.parse(await readFile(await (await detailDownload).path(), 'utf8'));
  check('config export includes exact seed, style, settings and measured gaps', exported.seed === records[0].seed && exported.style === records[0].style && JSON.stringify(exported.parameters) === JSON.stringify(records[0].parameters) && exported.summary.adjacentOpenGround === 1);
  await page.keyboard.press('Escape'); check('escape closes the inspector', !(await page.locator('#inspector').evaluate(dialog => dialog.open)));
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
  check('mobile gallery fits the viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/review-mobile.png`, fullPage: true });
  await page.locator('[data-id="C3"] .forest-jump').click(); await waitWorld();
  check('mobile detail fits the viewport', await page.locator('#inspector').evaluate(dialog => dialog.getBoundingClientRect().right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth));
  await page.screenshot({ path: `${output}/review-mobile-detail.png` });
  check('standalone HTML makes no network requests', network.length === 0, network);
  check('no browser runtime errors', errors.length === 0, errors);
} finally {
  const result = { checks, errors, network }; await writeFile(`${output}/review-checks.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); await browser.close();
}
