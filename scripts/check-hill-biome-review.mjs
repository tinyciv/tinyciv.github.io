import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const folder = 'scratch/2026-11-07-tiered-hill-biomes';
const artifact = pathToFileURL(resolve('output/hill-biome-worlds.html')).href;
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 1080 }, deviceScaleFactor: 1, acceptDownloads: true, hasTouch: true });
const checks = [], errors = [], externalRequests = [], scenes = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { const url = request.url(); if (url !== artifact && !/^(data|blob):/.test(url)) externalRequests.push(url); });
const check = (name, pass, detail) => {
  checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  assert.ok(pass, `${name}: ${JSON.stringify(detail)}`);
};
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const image = () => page.locator('#map').evaluate(canvas => canvas.toDataURL());
const view = () => page.evaluate(() => JSON.stringify(window.__hillReview.view));
async function saveMap(name) { await writeFile(`${folder}/${name}.png`, Buffer.from((await image()).split(',')[1], 'base64')); }
async function toggle(id) { await page.locator(`#${id}`).click(); await settle(); }
async function loadWorld(id) {
  const index = await page.evaluate(id => window.__hillReview.records.findIndex(record => record.id === id), id);
  await page.locator('#world').selectOption(String(index));
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 60000 });
  await page.waitForFunction(index => window.__hillReview.state.world === index, index);
  await settle();
}

try {
  await page.goto(artifact);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready); await settle();
  const records = await page.evaluate(() => window.__hillReview.records.map(({ compressedScene, ...record }) => record));
  check('three distinct generated world records are embedded', records.length === 3 && new Set(records.map(record => record.id)).size === 3 && new Set(records.map(record => record.seed)).size === 3, records);
  check('the world selector exposes all three maps', await page.locator('#world option').count() === 3);
  const files = {
    world: 'public/assets/puny-world/overworld.png', desert: 'public/assets/puny-world/desert-ledges.png',
    medieval: 'public/assets/vegetation/medieval-nature.png', salt: 'public/assets/resources/salt-pan-joins.png',
    ...Object.fromEntries(['2A', '2B', '2C', '2D'].map(id => [`marsh-${id}`, `public/assets/vegetation/marsh/${id}.png`])),
  };
  const embedded = await page.evaluate(() => window.HILL_REVIEW_ASSETS);
  for (const [id, path] of Object.entries(files)) check(`${id}: embedded pixels match the existing game artwork`, Buffer.from(embedded[id].split(',')[1], 'base64').equals(await readFile(path)));
  check('Pixel Operator is loaded for the viewer', await page.evaluate(() => document.fonts.check('20px "Pixel Operator"') && getComputedStyle(document.body).fontFamily.includes('Pixel Operator')));
  const detailImages = [], worldImages = [];
  for (const record of records) {
    await loadWorld(record.id);
    const metadata = await page.evaluate(() => {
      const { scene, state } = window.__hillReview;
      return { state, seed: scene.world.seed, width: scene.world.width, height: scene.world.height, regions: scene.regions, metrics: scene.metrics };
    });
    scenes.push({ id: record.id, ...metadata });
    check(`${record.id}: selected world contains a complete tile map`, await page.evaluate(() => { const w = window.__hillReview.scene.world; return w.tiles.length === w.width * w.height && w.width >= 128 && w.height >= 128; }));
    await toggle('whole');
    check(`${record.id}: Whole world fits the complete map in the viewport`, await page.evaluate(() => {
      const { scene, state, view } = window.__hillReview;
      return state.whole && scene.world.width * state.zoom <= view.width + 1 && scene.world.height * state.zoom <= view.height + 1;
    }));
    worldImages.push(await image());
    await saveMap(`world-${record.id}`);
    await page.screenshot({ path: `${folder}/viewer-${record.id}-whole.png`, fullPage: true });
    for (const biome of ['desert', 'forest']) {
      await toggle(biome);
      check(`${record.id} ${biome}: biome button selects its inspection view`, await page.locator(`#${biome}`).getAttribute('aria-pressed') === 'true');
      detailImages.push(await image());
      await saveMap(`${record.id}-${biome}`);
      await page.screenshot({ path: `${folder}/viewer-${record.id}-${biome}.png`, fullPage: true });
      const beforeRamps = await image(); await toggle('ramps');
      check(`${record.id} ${biome}: ramp highlighting changes the actual map`, await image() !== beforeRamps && await page.locator('#ramps').getAttribute('aria-pressed') === 'true');
      await saveMap(`${record.id}-${biome}-ramps`);
      await toggle('ramps');
      check(`${record.id} ${biome}: hiding ramp markers restores the terrain image`, await image() === beforeRamps);
      if (biome === 'forest') {
        const beforeTrees = await image(); await toggle('trees');
        check(`${record.id}: lifting forest trees exposes the terrain`, await image() !== beforeTrees && await page.locator('#trees').getAttribute('aria-pressed') === 'true');
        await saveMap(`${record.id}-forest-bare`);
        await toggle('trees'); check(`${record.id}: restoring trees exactly restores the scene`, await image() === beforeTrees);
      }
      await toggle('tiered');
      check(`${record.id} ${biome}: two-level navigation reveals an upper terrace`, await page.evaluate(() => {
        const {scene,state,view}=window.__hillReview;
        return scene.world.tiles.some((tile,cell)=>tile.ridgeTier===2&&tile.stair
          &&cell%scene.world.width>=view.left&&cell%scene.world.width<view.left+view.width/state.zoom
          &&Math.floor(cell/scene.world.width)>=view.top&&Math.floor(cell/scene.world.width)<view.top+view.height/state.zoom);
      }));
      await saveMap(`${record.id}-${biome}-two-level`);
    }
  }
  check('all whole-world maps differ', new Set(worldImages).size === 3);
  check('all six biome detail views differ', new Set(detailImages).size === 6);
  await loadWorld(records[0].id); await toggle('desert');
  const beforeGrid = await image(); await toggle('grid'); check('tile grid redraws the map', await image() !== beforeGrid);
  await saveMap('desert-grid'); await toggle('grid'); check('grid removal restores the terrain', await image() === beforeGrid);
  const beforeZoom = await view(); await toggle('zoom-in'); check('zoom-in changes the visible terrain extent', await view() !== beforeZoom);
  const zoomed = await view(); await toggle('zoom-out'); check('zoom-out changes the visible terrain extent', await view() !== zoomed);
  await toggle('native');
  check('native view uses exactly 32 pixels per tile', await page.evaluate(() => window.__hillReview.state.zoom === 32));
  const beforePan = await view(), bounds = await page.locator('#map').boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .5);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .5 + 95, bounds.y + bounds.height * .5 + 45, { steps: 6 }); await page.mouse.up(); await settle();
  check('dragging pans the terrain', await view() !== beforePan);
  const beforeWheel = await view(); await page.mouse.wheel(0, -340); await settle();
  check('mouse wheel zoom changes the map extent', await view() !== beforeWheel);
  await toggle('native');
  const beforeDouble = await view();
  await page.locator('#map').dblclick({ position: { x: bounds.width * .6, y: bounds.height * .45 } }); await settle();
  check('double click zooms toward the inspected terrain', await view() !== beforeDouble);
  const beforeMini = await view(); await page.locator('#minimap').click({ position: { x: 62, y: 91 } }); await settle();
  check('minimap click navigates to another part of the whole world', await view() !== beforeMini);
  await toggle('forest');
  const beforeKey = await view(); await page.locator('#map').focus(); await page.keyboard.press('ArrowRight'); await settle();
  check('keyboard navigation pans the map', await view() !== beforeKey);
  const downloadEvent = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloadEvent;
  const chunks = [], stream = await download.createReadStream(); for await (const chunk of stream) chunks.push(chunk); const png = Buffer.concat(chunks);
  const size = await page.locator('#map').evaluate(canvas => [canvas.width, canvas.height]);
  check('PNG export preserves the current viewport resolution', png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.readUInt32BE(16) === size[0] && png.readUInt32BE(20) === size[1], size);
  await writeFile(`${folder}/exported-view.png`, png);
  await toggle('whole'); await page.screenshot({ path: `${folder}/review-desktop.png`, fullPage: true });
  check('desktop viewer has no horizontal page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  await toggle('whole');
  check('390px mobile viewer has no horizontal page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${folder}/review-mobile-whole.png`, fullPage: true });
  for (const biome of ['desert', 'forest']) {
    await toggle(biome);
    check(`mobile ${biome}: map stays within the screen`, await page.locator('#map').evaluate(canvas => { const r = canvas.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.height > 250; }));
    await page.screenshot({ path: `${folder}/review-mobile-${biome}.png`, fullPage: true });
  }
  await page.locator('#map').scrollIntoViewIfNeeded();
  const mobileMap = await page.locator('#map').boundingBox(), center = { x: mobileMap.x + mobileMap.width / 2, y: mobileMap.y + mobileMap.height / 2 };
  const beforePinch = await page.evaluate(() => window.__hillReview.state.zoom), touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x - 38, y: center.y, id: 1 }, { x: center.x + 38, y: center.y, id: 2 }] });
  for (const delta of [50, 65, 80]) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x - delta, y: center.y, id: 1 }, { x: center.x + delta, y: center.y, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await settle();
  check('mobile pinch zoom increases the map scale', await page.evaluate(() => window.__hillReview.state.zoom) > beforePinch);
  await touch.detach();
  check('the standalone file requests no external resources', externalRequests.length === 0, externalRequests);
  check('the browser reports no runtime errors', errors.length === 0, errors);
} finally {
  await writeFile(`${folder}/browser-checks.json`, JSON.stringify({ checks, errors, externalRequests }, null, 2));
  await writeFile(`${folder}/browser-scenes.json`, JSON.stringify(scenes, null, 2));
  console.log(JSON.stringify({ passed: checks.filter(check => check.pass).length, total: checks.length, errors, externalRequests }, null, 2));
  await browser.close();
}
