import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-11-01-library-farms';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const worldClick = async point => {
  const screen = await page.evaluate(point => __game.renderer.screenPoint(point), point);
  await page.mouse.click(screen.x, screen.y);
};
const chooseLibrary = async () => {
  await page.keyboard.press('b');
  await page.locator('[data-build="library"]').click();
  assert.equal(await page.evaluate(() => __game.state.buildMode), 'library');
};
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { __game.state.paused = true; window.__libraryGeneratedState = __game.state; });
  await page.evaluate(async () => {
    const { synchronizeFarms, ensureCollectors } = await import('/src/game/farms.ts');
    const { ensureBuilders } = await import('/src/game/builders.ts');
    const { updateFog } = await import('/src/game/fog.ts');
    const make = (id, kind, x, y) => ({ id, kind, x, y, faction: 0, hp: 500, maxHp: 500, capacity: 0 });
    const state = {
      world: { width: 40, height: 30, seed: 'library-farm-e2e', source: 'test', spawns: [{ x: 14, y: 14 }], revision: 0,
        tiles: Array.from({ length: 1200 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
          moisture: .7, food: 3, production: 1, gold: 0, variation: .5 })) },
      buildings: [ { ...make(100, 'palace', 14, 14), cityName: 'Roma', unhousedResidents: 20,
        governorPermissions: { farms: false, housing: false } },
        ...[[18, 14], [19, 14], [18, 15], [19, 15]].map(([x,y], i) => make(101+i, 'camp', x, y)) ],
      units: [{ id: 1, kind: 'leader', faction: 0, x: 17.3, y: 13.5, hp: 100, maxHp: 100, morale: 100,
        attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60,
        moving: false, facing: 0, attackTime: 0 }],
      factions: [{ id: 0, name: 'Romans', color: '#ee3434', affinity: 100, relation: 'self', food: 500,
        gold: 1000, population: 20, production: 0, culture: 10000, yields: { food: 10, gold: 20, production: 0 },
        nextRaid: Infinity, defeated: false }], fields: [],
      time: 10, tick: 0, paused: true, speed: 1, events: [], particles: [], selected: 1, selectedType: 'unit',
      buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'library-farm-e2e', rngState: 1,
      raiderCamps: [], marauderPacks: [], treasures: [], villages: [],
    };
    __game.replaceState(state); synchronizeFarms(state); ensureBuilders(state); ensureCollectors(state); updateFog(state);
    for (const field of state.fields) {
      field.food = 2; field.foodBatches = [{ amount: 2, expiresAt: 100 }]; field.nextHarvest = 150;
    }
    __game.renderer.prepare(state); __game.renderer.zoom = 1.7;
    __game.renderer.camera = { x: 17, y: 14 }; __game.renderer.follow = false;
  });
  // First prove that the very same crop click can normally open its activity.
  await worldClick({ x: 18.5, y: 14.5 });
  await page.waitForFunction(() => !document.querySelector('#building-activity').hidden);
  assert.equal(await page.locator('#building-activity-title').textContent(), 'Orchard upgrades');
  await page.keyboard.press('Escape');
  const before = await page.evaluate(() => ({
    gold: __game.state.factions[0].gold,
    farms: __game.state.buildings.filter(b => b.kind === 'camp').map(b => ({ id: b.id, x: b.x, y: b.y })),
    crops: __game.state.fields.map(f => ({ camp: f.camp, food: f.food, foodBatches: f.foodBatches, nextHarvest: f.nextHarvest })),
  }));
  await chooseLibrary();
  const screen = await page.evaluate(() => __game.renderer.screenPoint({ x: 18.5, y: 14.5 }));
  await page.mouse.move(screen.x, screen.y);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${output}/placement-preview.png` });
  await worldClick({ x: 18.5, y: 14.5 });
  const placed = await page.evaluate(() => ({
    gold: __game.state.factions[0].gold,
    library: __game.state.buildings.find(b => b.kind === 'library'),
    farms: __game.state.buildings.filter(b => b.kind === 'camp').map(b => ({ id: b.id, x: b.x, y: b.y })),
    crops: __game.state.fields.map(f => ({ camp: f.camp, food: f.food, foodBatches: f.foodBatches, nextHarvest: f.nextHarvest })),
    popup: !document.querySelector('#building-activity').hidden,
    status: document.querySelector('#build-status').textContent,
  }));
  assert.ok(placed.library, `UI click must order library: ${placed.status}`);
  assert.equal(placed.popup, false, 'farm popup must not consume the library-placement click');
  assert.equal(placed.gold, before.gold - 250);
  assert.deepEqual({ x: placed.library.x, y: placed.library.y }, { x: 18, y: 14 });
  assert.equal(placed.library.construction.duration, 90);
  assert.equal(placed.farms.length, 4);
  assert.equal(new Set(placed.farms.map(b => `${b.x},${b.y}`)).size, 4);
  assert.ok(placed.farms.every(b => b.x < 18 || b.x >= 20 || b.y < 14 || b.y >= 16));
  assert.deepEqual(placed.crops, before.crops, 'food and crop deadlines survive relocation');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${output}/library-ordered.png` });
  // Run the real simulation and builders; do not manually complete construction.
  const completed = await page.evaluate(() => {
    const s = __game.state;
    s.paused = false;
    let workingAt = null;
    for (let step = 0; step < 1800; step++) {
      __game.step(.1);
      const library = s.buildings.find(b => b.kind === 'library');
      if (library?.construction?.waitingForBuilder === false && workingAt === null) workingAt = s.time;
      if (library && !library.construction) break;
    }
    s.paused = true;
    return { time: s.time, workingAt, library: s.buildings.find(b => b.kind === 'library'),
      remainingCrops: s.fields.length,
      overlappingCrops: s.fields.filter(f => f.x >= 18 && f.x < 20 && f.y >= 14 && f.y < 16).length };
  });
  assert.ok(completed.workingAt !== null, 'a real builder must reach and work on the site');
  assert.equal(completed.library.construction, undefined, 'library completes through actual construction');
  assert.equal(completed.remainingCrops, 4);
  assert.equal(completed.overlappingCrops, 0);
  await worldClick({ x: 19, y: 14.5 });
  await page.waitForFunction(() => !document.querySelector('#building-activity').hidden);
  assert.equal(await page.locator('#building-activity-title').textContent(), 'Research');
  await page.screenshot({ path: `${output}/library-completed.png` });
  await page.keyboard.press('Escape');
  // Repeat the UI placement on naturally generated farms, terrain and borders.
  const natural = await page.evaluate(async () => {
    const { validateBuildAt } = await import('/src/game/simulation.ts');
    const s = window.__libraryGeneratedState;
    __game.replaceState(s); s.paused = true; s.buildMode = null;
    const leader = s.units.find(u => u.kind === 'leader' && u.faction === 0);
    const farms = s.buildings.filter(b => b.kind === 'camp' && b.faction === 0 && b.hp > 0 && !b.construction);
    for (const farm of farms) {
      const under = farms.filter(b => b.x >= farm.x && b.x < farm.x + 2 && b.y >= farm.y && b.y < farm.y + 2);
      if (under.length !== 4) continue;
      Object.assign(leader, { x: farm.x - .5, y: farm.y + .5, path: undefined, destination: undefined });
      if (!validateBuildAt(s, 'library', farm.x, farm.y).ok) continue;
      __game.renderer.prepare(s); __game.renderer.zoom = 1.5;
      __game.renderer.camera = { x: farm.x + 1, y: farm.y + 1 }; __game.renderer.follow = false;
      return { x: farm.x, y: farm.y, seed: s.seed, gold: s.factions[0].gold, ids: under.map(b => b.id) };
    }
    throw Error('Generated starting city must provide a legal four-farm library site');
  });
  await chooseLibrary();
  const naturalScreen = await page.evaluate(p => __game.renderer.screenPoint({ x: p.x + .5, y: p.y + .5 }), natural);
  await page.mouse.move(naturalScreen.x, naturalScreen.y);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${output}/generated-preview.png` });
  await page.mouse.click(naturalScreen.x, naturalScreen.y);
  const naturalResult = await page.evaluate(p => ({
    library: __game.state.buildings.find(b => b.kind === 'library' && b.x === p.x && b.y === p.y),
    gold: __game.state.factions[0].gold,
    moved: __game.state.buildings.filter(b => p.ids.includes(b.id)
      && (b.x < p.x || b.x >= p.x + 2 || b.y < p.y || b.y >= p.y + 2)).length,
  }), natural);
  assert.ok(naturalResult.library, 'naturally generated farmland accepts a library through the UI');
  assert.equal(naturalResult.moved, 4);
  assert.equal(naturalResult.gold, natural.gold - 250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${output}/generated-ordered.png` });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/report.json`, JSON.stringify({ before, placed, completed, natural, naturalResult, errors }, null, 2));
  console.log(JSON.stringify({ pass: true, movedFarms: placed.farms.length, cost: before.gold - placed.gold,
    workStartedAt: completed.workingAt, completedAt: completed.time, errors }));
} catch (error) {
  console.error(await page.evaluate(() => ({ status: document.querySelector('#build-status')?.textContent,
    mode: window.__game?.state.buildMode, popup: document.querySelector('#building-activity-title')?.textContent,
    library: window.__game?.state.buildings.find(b => b.kind === 'library') })));
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally { await browser.close(); }
