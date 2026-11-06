import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// A disposable browser context keeps the player's current game untouched.
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const output = 'scratch/2026-10-27-grain-integration';
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
mkdirSync(output, { recursive: true });

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready');
  const pixels = await page.evaluate(async () => {
    const { drawFarmField, drawFarmFence, loadFarmArt } = await import('/src/game/farm-art.ts');
    const { icon } = await import('/src/ui/icons.ts');
    await loadFarmArt();
    const load = async src => { const image = new Image(); image.src = src; await image.decode(); return image; };
    const sheet = await load('/scratch/2026-10-27-grain-palettes/assets/grain-1C.png');
    const installed = await load('/assets/miniworld/Wheatfield-DryStraw.png');
    const original = await load('/assets/miniworld/Wheatfield.png');
    const nativePixels = image => {
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const c = canvas.getContext('2d'); c.drawImage(image, 0, 0);
      return c.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const approved = nativePixels(sheet), actualSheet = nativePixels(installed), source = nativePixels(original);
    let approvedDifferences = 0, alphaDifferences = 0, harvestedDifferences = 0;
    for (let i = 0; i < approved.length; i += 4) {
      if ([0, 1, 2, 3].some(k => approved[i + k] !== actualSheet[i + k])) approvedDifferences++;
      if (source[i + 3] !== actualSheet[i + 3]) alphaDifferences++;
      if (i / 4 % 64 < 16 && [0, 1, 2, 3].some(k => source[i + k] !== actualSheet[i + k])) harvestedDifferences++;
    }
    const field = { id: 1, camp: 1, faction: 0, x: 10, y: 10, planted: true, food: 0, nextHarvest: 60, harvestedAt: 30 };
    const results = [];
    for (const size of [32, 43.2]) for (const [stage, time] of [[0, 30], [1, 36], [2, 40], [3, 42]]) {
      const actual = document.createElement('canvas'), expected = document.createElement('canvas');
      actual.width = expected.width = actual.height = expected.height = 64;
      const a = actual.getContext('2d'), e = expected.getContext('2d');
      a.imageSmoothingEnabled = e.imageSmoothingEnabled = false;
      drawFarmField(a, 8.25, 7.75, size, time, field);
      e.drawImage(sheet, stage * 16, 0, 16, 16, 8.25, 7.75, size, size);
      const ap = a.getImageData(0, 0, 64, 64).data, ep = e.getImageData(0, 0, 64, 64).data;
      let mismatchedPixels = 0, visiblePixels = 0;
      for (let i = 0; i < ap.length; i += 4) {
        if (ap[i + 3]) visiblePixels++;
        if (ap[i] !== ep[i] || ap[i + 1] !== ep[i + 1] || ap[i + 2] !== ep[i + 2] || ap[i + 3] !== ep[i + 3]) mismatchedPixels++;
      }
      results.push({ stage, time, size, mismatchedPixels, visiblePixels });
    }
    const untouched = document.createElement('canvas'); untouched.width = untouched.height = 32;
    const u = untouched.getContext('2d'); u.fillStyle = '#63872d'; u.fillRect(0, 0, 32, 32);
    const before = untouched.toDataURL();
    drawFarmField(u, 0, 0, 32, 40, { ...field, planted: false });
    const markup = document.createElement('div'); markup.innerHTML = icon('camp');
    const hud = await load(markup.querySelector('img').src), expectedIcon = document.createElement('canvas');
    expectedIcon.width = expectedIcon.height = 48;
    const ic = expectedIcon.getContext('2d'); ic.imageSmoothingEnabled = false;
    ic.drawImage(sheet, 48, 0, 16, 16, 0, 0, 48, 48);
    drawFarmFence(ic, 0, 0, 48, { north: true, east: true, south: true, west: true });
    const hudPixels = nativePixels(hud), expectedPixels = ic.getImageData(0, 0, 48, 48).data;
    let iconDifferences = 0;
    for (let i = 0; i < hudPixels.length; i++) if (hudPixels[i] !== expectedPixels[i]) iconDifferences++;
    return { dimensions: [installed.naturalWidth, installed.naturalHeight], approvedDifferences, alphaDifferences, harvestedDifferences,
      results, unplantedUnchanged: before === untouched.toDataURL(), iconDifferences };
  });
  assert.deepEqual(pixels.dimensions, [64, 16]);
  assert.equal(pixels.approvedDifferences, 0, 'Installed sheet must exactly match approved 1C');
  assert.equal(pixels.alphaDifferences, 0, 'Native transparent silhouette must be preserved');
  assert.equal(pixels.harvestedDifferences, 0, 'Harvested stage must retain its source pixels');
  assert.equal(pixels.iconDifferences, 0, 'Farm HUD must use approved 1C ripe grain');
  for (const result of pixels.results) {
    assert.equal(result.mismatchedPixels, 0, `Miniworld stage ${result.stage} at ${result.size}px must match approved 1C exactly`);
    assert.ok(result.visiblePixels > 300);
  }
  assert.equal(pixels.unplantedUnchanged, true);
  console.log('PASS installed 1C sheet, all four growth stages at normal/fractional zoom, native alpha, harvested stage, farm HUD, and unplanted ground');

  await page.evaluate(() => {
    const game = window.__game;
    game.newWorld('BTV-847');
    game.state.paused = true;
    game.renderer.center(game.state);
    game.renderer.zoom = 1.7;
    game.renderer.hover = null;
  });
  const harvest = await page.evaluate(async () => {
    const { updateHarvests } = await import('/src/game/farms.ts');
    const { state, renderer } = window.__game;
    const fields = state.fields.filter(field => field.faction === 0);
    fields.forEach(field => { field.nextHarvest = 30; field.food = 0; delete field.harvestedAt; });
    const foodBefore = state.factions[0].food;
    state.time = 30;
    updateHarvests(state);
    renderer.draw(state, 0);
    return { count: fields.length, foodBefore, foodAfter: state.factions[0].food,
      fields: fields.map(field => ({ planted: field.planted, food: field.food, harvestedAt: field.harvestedAt, nextHarvest: field.nextHarvest })) };
  });
  assert.ok(harvest.count >= 18, 'Starting settlement includes two complete farms');
  assert.equal(harvest.foodAfter, harvest.foodBefore, 'Harvests remain physical food until a peasant delivers them');
  for (const field of harvest.fields) {
    assert.equal(field.planted, true); assert.ok(field.food > 0);
    assert.equal(field.harvestedAt, 30); assert.equal(field.nextHarvest, 60);
  }
  for (const [label, time] of [['harvested', 30], ['green', 36], ['ripening', 40], ['ripe', 42]]) {
    await page.evaluate(time => { const { state, renderer } = window.__game; state.time = time; renderer.draw(state, 0); }, time);
    await page.mouse.move(1380, 90);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${output}/miniworld-${label}.png` });
  }
  await page.keyboard.press('b');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${output}/miniworld-build-menu.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${output}/miniworld-mobile.png` });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/report.json`, JSON.stringify({ pixels, harvest, errors }, null, 2) + '\n');
  console.log(`PASS actual harvest timing, physical food, farm HUD, mobile layout, and no runtime errors; screenshots in ${output}`);
} finally {
  await browser.close();
}
