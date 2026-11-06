import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const clickWorld = async point => {
  const screen = await page.evaluate(point => __game.renderer.screenPoint(point), point);
  await page.mouse.click(screen.x, screen.y);
};
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.evaluate(async () => {
    const { createGame } = await import('/src/game/simulation.ts');
    const world = { width: 40, height: 30, seed: 'city-controls', source: 'test', spawns: [{ x: 15, y: 12 }],
      tiles: Array.from({ length: 1200 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, variation: .5, food: 3, production: 1, gold: 0 })) };
    let state = createGame(world); const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === 0);
    Object.assign(leader, { x: 15.5, y: 15.5, destination: undefined, path: undefined, target: undefined });
    state = { ...state, units: [leader], buildings: [
      { id: 10001, kind: 'palace', faction: 0, x: 15, y: 12, hp: 650, maxHp: 650, capacity: 0, cityName: 'Roma' },
      { id: 10002, kind: 'blacksmith', faction: 0, x: 18, y: 14, hp: 250, maxHp: 250, capacity: 0 },
    ], fields: [], raiderCamps: [], marauderPacks: [], treasures: [], paused: true, selected: leader.id, selectedType: 'unit' };
    for (const tile of world.tiles) { tile.overlay = 'none'; delete tile.farm; }
    __game.replaceState(state);
    __game.renderer.prepare(__game.state); __game.renderer.center(__game.state); __game.renderer.zoom = 1.4;
  });
  await page.keyboard.press('b');
  await page.waitForFunction(() => !document.querySelector('[data-build="house"]').hidden);
  await clickWorld({ x: 16, y: 12.6 });
  await page.waitForFunction(() => !document.querySelector('#building-activity').hidden);
  assert.equal(await page.locator('#building-activity-title').textContent(), 'Settlement');
  await clickWorld({ x: 16, y: 12.6 });
  assert.equal(await page.locator('#building-activity').isVisible(), false, 'same building toggles closed');

  for (const [kind, point, title] of [['house', { x: 16, y: 12.6 }, 'Settlement'],
    ['road', { x: 18.5, y: 14.5 }, 'Blacksmith']]) {
    await page.keyboard.press('b');
    await page.locator(`[data-build="${kind}"]`).click();
    const before = await page.evaluate(() => ({ gold: __game.state.factions[0].gold, buildings: __game.state.buildings.length }));
    await clickWorld(point);
    await page.waitForFunction(() => !document.querySelector('#building-activity').hidden);
    assert.equal(await page.locator('#building-activity-title').textContent(), title);
    assert.deepEqual(await page.evaluate(() => ({ gold: __game.state.factions[0].gold, buildings: __game.state.buildings.length })), before);
    assert.equal(await page.evaluate(() => __game.state.buildMode), null, 'activity consumes the placement click');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#building-activity').isVisible(), false);
  }
  await page.evaluate(() => { const leader = __game.state.units[0]; leader.x = 10; leader.y = 17; __game.renderer.follow = false; });
  await page.keyboard.press('b'); await page.locator('[data-build="house"]').click();
  await clickWorld({ x: 16, y: 12.6 });
  assert.equal(await page.locator('#building-activity').isVisible(), false, 'out-of-range buildings do not open');
  assert.equal(await page.evaluate(() => __game.state.buildMode), 'house', 'out-of-range click retains construction tool');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { __game.state.units[0].x = 15.5; __game.state.units[0].y = 15.5; });
  await clickWorld({ x: 16, y: 12.6 });
  mkdirSync('scratch/2026-10-29-city-expansion', { recursive: true });
  await page.screenshot({ path: 'scratch/2026-10-29-city-expansion/activity-popup.png' });
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const state = __game.state;
    state.factions[0].gold = 63;
    state.units[0].x = 18.5; state.units[0].y = 17.5;
    for (let y = 0; y < state.world.height; y++) for (let x = 20; x < 28; x++)
      state.world.tiles[y * state.world.width + x].terrain = ['river', 'coast', 'ocean', 'lake'][x % 4];
    state.world.revision = (state.world.revision ?? 0) + 1;
    __game.renderer.camera = { x: 23, y: 16 }; __game.renderer.follow = false;
  });
  await page.keyboard.press('b'); await page.locator('[data-build="bridge"]').click();
  const water = await page.evaluate(() => __game.renderer.screenPoint({ x: 22.5, y: 17.5 }));
  await page.mouse.move(water.x, water.y);
  await page.waitForFunction(() => document.querySelector('#build-status').textContent.includes('64 gold'));
  assert.match(await page.locator('#build-status').textContent(), /Need 64 gold/);
  await page.mouse.click(water.x, water.y);
  assert.equal(await page.evaluate(() => __game.state.buildings.filter(building => building.kind === 'bridge').length), 0);
  assert.equal(await page.evaluate(() => __game.state.factions[0].gold), 63);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { __game.state.factions[0].gold = 64; });
  await page.keyboard.press('b'); await page.locator('[data-build="bridge"]').click();
  await page.mouse.move(water.x, water.y);
  await page.waitForFunction(() => document.querySelector('#build-status').textContent.includes('8 tiles · 64 gold'));
  await page.screenshot({ path: 'scratch/2026-10-29-city-expansion/bridge-preview.png' });
  await page.mouse.click(water.x, water.y);
  assert.equal(await page.evaluate(() => __game.state.buildings.filter(building => building.kind === 'bridge').length), 8);
  assert.equal(await page.evaluate(() => __game.state.factions[0].gold), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: activity popups, toggle/Escape/range, eight-tile all-water bridge preview/cost/purchase, and atomic insufficient-gold rejection.');
} catch (error) {
  console.error(await page.evaluate(() => ({ status: document.querySelector('#build-status')?.textContent,
    hover: window.__game?.renderer.hover, mode: window.__game?.state.buildMode, gold: window.__game?.state.factions[0].gold })));
  await page.screenshot({ path: 'scratch/2026-10-29-city-expansion/browser-failure.png' });
  throw error;
} finally { await browser.close(); }
