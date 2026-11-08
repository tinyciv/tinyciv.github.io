import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(String(error)));
const check = name => console.log(`PASS ${name}`);
const nearPoint = (actual, expected) => assert.ok(actual && Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-5,
  `${JSON.stringify(actual)} is not near ${JSON.stringify(expected)}`);
const advance = seconds => page.evaluate(value => { const g = window.__game; g.state.paused = false; for (let remaining = value; remaining > 1e-7; remaining -= .1) g.step(Math.min(.1, remaining)); g.state.paused = true; }, seconds);
const waitForBuilder = (kind, timeout = 60) => page.evaluate(({ kind, timeout }) => {
  const g = window.__game;
  for (let i = 0; i < timeout * 10; i++) {
    const building = g.state.buildings.find(b => b.kind === kind);
    if (building?.construction?.waitingForBuilder === false) return { started: true, elapsed: g.state.time - building.construction.startedAt,
      worker: g.state.units.some(u => u.builder && u.buildSite === building.id && u.buildPhase === 'working' && !u.inside) };
    g.state.paused = false; g.step(.1); g.state.paused = true;
  }
  return { started: false };
}, { kind, timeout });
const clickWorld = async (point, button = 'left') => { const p = await page.evaluate(p => window.__game.renderer.screenPoint(p), point); await page.mouse.click(p.x, p.y, { button }); };
const fixture = async () => {
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
  const { createGame } = await import('/src/game/simulation.ts');
  const world = { width: 48, height: 36, seed: 'browser-farms', source: 'integration fixture', spawns: [{ x: 20, y: 16 }],
    tiles: Array.from({ length: 48 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .6, variation: .4, food: 2, production: 2, gold: 1 })) };
  const state = createGame(world); window.__game.entities(state).units.replace(state.units.filter(u => u.faction === 0));
  window.__game.entities(state).buildings.replace(state.buildings.filter(b => b.faction === 0));
  state.factions = state.factions.filter(faction => faction.id === 0);
  state.marauderPacks = []; state.raiderCamps = []; state.villages = []; state.tradeRoutes = [];
  state.wildlife = { herds: [], nextRespawnAt: Infinity, sequence: 0, targetHerds: 0 };
  state.fogRaids = { nextAt: Infinity, waves: 0, pressureVersion: 2 };
  state.paused = true;
  for (const building of state.buildings) if (building.kind === 'palace') building.governorPermissions = { farms: false, housing: false };
  window.__game.replaceState(state); window.__game.renderer.prepare(state); window.__game.renderer.center(state); window.__game.renderer.zoom = 1.4;
  });
};
mkdirSync('output', { recursive: true });
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready');
  await page.evaluate(() => { window.__game.newWorld('BTV-847'); window.__game.state.paused = true; });
  assert.equal(await page.title(), 'TinyCiv (BTV)');
  assert.equal(await page.locator('#world-menu,#notifications,#objectives,#toast,.world-heading,.season,.map-tools,#toggle-yields,#toggle-build,#follow-leader').count(), 0);
  assert.equal(await page.locator('#build-panel').isVisible(), false);
  const minimap = await page.locator('.minimap-panel').boundingBox(), bar = await page.locator('.resource-bar').boundingBox();
  assert.equal(minimap.x, 0); assert.equal(minimap.y + minimap.height, 900);
  assert.equal(bar.x, 0); assert.equal(bar.y, 0); assert.equal(bar.width, 1440);
  assert.deepEqual(await page.evaluate(() => { const f = window.__game.state.factions[0]; return [f.food, f.gold, f.production, f.population]; }), [500, 500, 0, 20]);
  assert.equal(await page.locator('.action-slot:disabled').count(), 10);
  assert.deepEqual(await page.locator('#selection-stats .stat-label').allTextContents(), ['HP', 'Attack', 'Defense']);
  assert.equal(await page.locator('.portrait .character-icon').count(), 1);
  await page.keyboard.press('y'); assert.equal(await page.evaluate(() => window.__game.renderer.showYields), true); await page.keyboard.press('y');
  await page.keyboard.press('h'); assert.equal(await page.locator('#dialog-title').textContent(), 'Controls'); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__game.state.paused), true);
  await page.mouse.move(1300, 100); await page.screenshot({ path: 'output/btv-desktop.png' });
  check('edge-anchored HUD, 20 starting residents, ten empty action slots, compact stats and keyboard controls');

  await fixture();
  const controls = await page.evaluate(() => {
    const g = window.__game, s = g.state, leader = s.units.find(u => u.kind === 'leader');
    window.__game.entities(s).units.replace([leader]); s.fields = []; window.__game.entities(s).buildings.replace(s.buildings.filter(b => b.kind === 'palace'));
    s.factions[0].population = 0;
    for (const tile of s.world.tiles) delete tile.farm;
    Object.assign(leader, { x: 8.5, y: 8.5, destination: undefined, path: undefined, target: undefined });
    g.renderer.center(s); g.renderer.moveMarker = null;
    return { start: { x: leader.x, y: leader.y }, target: { x: 12.5, y: 8.5 } };
  });
  await page.waitForTimeout(100);
  await clickWorld(controls.target);
  assert.equal(await page.evaluate(() => window.__game.state.units[0].destination ?? null), null);
  assert.deepEqual(await page.evaluate(() => { const u = window.__game.state.units[0]; return { x: u.x, y: u.y }; }), controls.start);
  const unhighlighted = await page.locator('#world').evaluate(canvas => canvas.toDataURL());
  const hover = await page.evaluate(() => window.__game.renderer.screenPoint({ x: 11.5, y: 9.5 }));
  await page.mouse.move(hover.x, hover.y); await page.waitForTimeout(80);
  assert.equal(await page.locator('#world').evaluate(canvas => canvas.toDataURL()), unhighlighted, 'ordinary mouse hover does not paint a tile highlight');
  await clickWorld(controls.target, 'right');
  const command = await page.evaluate(() => {
    const g = window.__game;
    return { destination: g.state.units[0].destination, marker: g.renderer.moveMarker && { x: g.renderer.moveMarker.x, y: g.renderer.moveMarker.y }, paused: g.state.paused };
  });
  nearPoint(command.destination, controls.target); nearPoint(command.marker, controls.target); assert.equal(command.paused, true);
  await clickWorld({ x: 10.5, y: 10.5 });
  assert.deepEqual(await page.evaluate(() => window.__game.state.units[0].destination), command.destination, 'left selection preserves the current move order');
  await page.waitForFunction(() => window.__game.renderer.moveMarker === null, undefined, { timeout: 2000 });
  await advance(3);
  assert.ok(await page.evaluate(target => { const u = window.__game.state.units[0]; return Math.hypot(u.x - target.x, u.y - target.y) < .25; }, controls.target));
  check('left click selects without moving, hover stays clear, right click moves with a brief marker even while paused');

  await fixture(); await page.waitForTimeout(160);
  const setup = await page.evaluate(() => { const s = window.__game.state; return { camps: s.buildings.filter(b => b.kind === 'camp').length, fields: s.fields.length, planted: s.fields.filter(f => f.planted).length, collectors: s.units.filter(u => u.collector).length }; });
  assert.ok(setup.camps > 0); assert.equal(setup.fields, setup.camps * 4);
  assert.equal(setup.planted, setup.fields); assert.ok(setup.collectors > 0);
  const delivery = await page.evaluate(() => {
    const g = window.__game; let harvested = false, pickedUp = false, returned = false;
    for (let i = 0; i < 900 && !returned; i++) {
      const before = g.state.factions[0].food;
      g.state.paused = false; g.step(.1); g.state.paused = true;
      harvested ||= g.state.fields.some(field => field.food > 0);
      pickedUp ||= g.state.units.some(u => u.collector && u.cargo > 0);
      returned = pickedUp && g.state.factions[0].food > before;
    }
    return { harvested, pickedUp, returned, stored: g.state.factions[0].food };
  });
  assert.equal(delivery.harvested, true); assert.equal(delivery.pickedUp, true); assert.equal(delivery.returned, true);
  await page.screenshot({ path: 'output/btv-harvest.png' });
  check('four plots per farm, staggered harvests, physical courier pickup and settlement delivery');

  await fixture();
  const towerSite = await page.evaluate(async () => {
    const { validateBuildAt } = await import('/src/game/simulation.ts'); const s = window.__game.state, l = s.units.find(u => u.kind === 'leader');
    s.factions[0].research = { focus: 'woodenTower', levels: { wall: 1, woodenTower: 1 }, progress: {} };
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const x = Math.floor(l.x) + dx, y = Math.floor(l.y) + dy; if (validateBuildAt(s, 'woodenTower', x, y).ok) return { x, y }; }
  });
  assert.ok(towerSite); await page.waitForTimeout(180); await page.keyboard.press('f');
  assert.deepEqual(await page.locator('[data-build]:not([hidden])').evaluateAll(buttons => buttons.map(button => button.dataset.build)), ['wall', 'woodenTower', 'guardPost']);
  await page.keyboard.press('3'); assert.equal(await page.evaluate(() => window.__game.state.buildMode), null);
  await page.keyboard.press('t'); await clickWorld({ x: towerSite.x + .5, y: towerSite.y + .5 });
  const tower = await page.evaluate(() => { const s = window.__game.state, b = s.buildings.find(b => b.kind === 'woodenTower'); return { b, resources: [s.factions[0].production, s.factions[0].gold] }; });
  assert.ok(tower.b?.construction); assert.equal(tower.b.construction.waitingForBuilder, true); assert.equal(tower.b.construction.duration, 15); assert.deepEqual(tower.resources, [0, 460]); assert.equal(tower.b.hp, 600); assert.equal(tower.b.armor, 6);
  await page.keyboard.press('Escape'); await clickWorld({ x: towerSite.x + .5, y: towerSite.y + .5 }); await page.waitForTimeout(160);
  assert.equal(await page.locator('#selection-name').textContent(), 'Wood tower');
  assert.match(await page.locator('#selection-panel').getAttribute('title'), /Awaiting builder|Builder en route/);
  await page.keyboard.press('f'); await page.keyboard.press('t'); await page.screenshot({ path: 'output/btv-tower-construction.png' }); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#selection-name').textContent(), 'Wood tower', 'opening construction preserves the inspected building');
  const builder = await waitForBuilder('woodenTower'); assert.equal(builder.started, true); assert.equal(builder.worker, true);
  await page.waitForTimeout(160); assert.match(await page.locator('#selection-panel').getAttribute('title'), /\d+s remaining/);
  await advance(14.8 - builder.elapsed); assert.equal(await page.evaluate(() => !!window.__game.state.buildings.find(b => b.kind === 'woodenTower').construction), true);
  const towerFinished = await page.evaluate(() => {
    const g = window.__game;
    // Traffic can briefly move the working peasant aside and pause construction.
    for (let i = 0; i < 300 && g.state.buildings.find(b => b.kind === 'woodenTower').construction; i++) {
      g.state.paused = false; g.step(.1); g.state.paused = true;
    }
    return !g.state.buildings.find(b => b.kind === 'woodenTower').construction;
  });
  assert.equal(towerFinished, true);
  check('Fortify/T tower UI, inert numeric slots, gold cost, preserved inspection and real timed construction');

  await page.evaluate(() => { window.__game.state.factions[0].gold = 123; return window.__game.save(); });
  await page.reload({ waitUntil: 'networkidle' }); await page.evaluate(() => window.__game.state.paused = true);
  assert.equal(await page.evaluate(() => window.__game.state.factions[0].gold), 123);
  assert.ok(await page.evaluate(() => window.__game.state.fields.length >= 8));
  check('saved resources and fields');

  await fixture();
  const roads = await page.evaluate(async () => {
    const { commandMove } = await import('/src/game/simulation.ts');
    const g = window.__game, s = g.state, l = s.units.find(u => u.kind === 'leader');
    window.__game.entities(s).units.replace([l]); s.fields = []; window.__game.entities(s).buildings.replace(s.buildings.filter(b => b.kind === 'palace')); s.factions[0].population = 0;
    Object.assign(s.buildings[0], { x: 6, y: 11 });
    // Traffic extends a connected road frontier inside territory; it does not
    // create a new disconnected road island.
    window.__game.entities(s).buildings.add({ id: Math.max(...s.buildings.map(b => b.id), l.id) + 1,
      kind: 'road', faction: 0, x: 7, y: 8, hp: 100, maxHp: 100, capacity: 0 });
    for (const t of s.world.tiles) delete t.farm;
    Object.assign(l, { x: 8.5, y: 8.5, destination: undefined, path: undefined });
    s.paused = false;
    for (let trip = 0; trip < 26; trip++) {
      const target = { x: trip % 2 ? 8.5 : 12.5, y: 8.5 }; commandMove(s, target.x, target.y);
      for (let step = 0; step < 100 && Math.hypot(l.x - target.x, l.y - target.y) > .2; step++) g.step(.1);
    }
    s.paused = true;
    const roadCells = s.buildings.filter(b => b.kind === 'road').map(b => [b.x, b.y]);
    return { roadCells, time: s.time };
  });
  assert.ok(roads.roadCells.length >= 4, JSON.stringify(roads)); assert.ok(roads.roadCells.every(([, y]) => y === 8)); assert.ok(roads.time < 180);
  check('repeated actual unit travel wears a narrow road into open terrain');

  await page.keyboard.press('n'); await page.locator('#new-seed').fill('BTV-browser-fresh'); await page.locator('#new-world').click();
  await page.waitForFunction(() => window.__game.state.seed === 'BTV-browser-fresh');
  await page.evaluate(() => window.__game.state.paused = true);
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const mini = await page.locator('.minimap-panel').boundingBox(); assert.ok(mini.x >= 0 && mini.x <= 5); assert.ok(Math.abs(mini.y + mini.height - 844) < 1);
  await page.screenshot({ path: 'output/btv-mobile.png' }); check('new-world shortcut and compact responsive HUD');
  await page.evaluate(() => { const g = window.__game; g.state.units.find(u => u.kind === 'leader' && u.faction === 0).hp = 0; g.state.paused = false; g.step(.1); });
  await page.waitForFunction(() => document.querySelector('#dialog-title')?.textContent === 'Defeat');
  await page.locator('#play-again').click(); await page.locator('#new-seed').fill('BTV-restart'); await page.locator('#new-world').click();
  await page.waitForFunction(() => window.__game.state.seed === 'BTV-restart');
  await page.evaluate(() => { const g = window.__game; g.state.factions.slice(1).forEach(f => f.defeated = true); g.step(.1); });
  await page.waitForFunction(() => document.querySelector('#dialog-title')?.textContent === 'Victory'); check('defeat, restart and victory');
  assert.deepEqual(errors, []); check('no browser runtime errors');
} finally { await browser.close(); }
