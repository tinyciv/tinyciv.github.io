import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(String(error)));
const screen = point => page.evaluate(p => window.__game.renderer.screenPoint(p), point);
const click = async point => { const p = await screen(point); await page.mouse.click(p.x, p.y); };
mkdirSync('output', { recursive: true });
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5176/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready');
  await page.evaluate(async () => {
    const { createGame } = await import('/src/game/simulation.ts');
    const { updateFog } = await import('/src/game/fog.ts');
    const world = { width: 40, height: 28, seed: 'gate-spacing-browser', source: 'test', spawns: [{ x: 4.5, y: 10.5 }],
      tiles: Array.from({ length: 40 * 28 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) };
    const state = createGame(world), leader = { ...state.units.find(unit => unit.kind === 'leader'), id: 2 };
    window.__game.entities(state).buildings.replace([{ id: 1, kind: 'palace', faction: 0, x: 3, y: 10, hp: 650, maxHp: 650, capacity: 0 }]);
    Object.assign(leader, { x: 14.5, y: 8.5, destination: undefined, path: undefined, order: 'hold' });
    window.__game.entities(state).units.replace([leader]); state.selected = 2; state.selectedType = 'unit';
    const addRoad = (x, y) => window.__game.entities(state).buildings.add({ id: 100 + state.buildings.length, kind: 'road', faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0, connected: true });
    for (let x = 5; x <= 18; x++) addRoad(x, 10);
    for (const x of [12, 15]) { addRoad(x, 11); addRoad(x, 12); }
    state.fields = []; state.raiderCamps = []; state.marauderPacks = []; state.treasures = [];
    state.fogRaids = { nextAt: 1e9, waves: 0, pressureVersion: 2 }; state.factions[0].gold = 1000;
    state.paused = true; state.gameOver = false; state.victory = false;
    updateFog(state); window.__game.replaceState(state);
    window.__game.renderer.prepare(window.__game.state);
    window.__game.renderer.camera = { x: 12.5, y: 11.5 }; window.__game.renderer.follow = false;
  });
  await page.keyboard.press('b'); await page.locator('[data-build="wall"]').click();
  const from = await screen({ x: 10.5, y: 12.5 }), to = await screen({ x: 18.5, y: 12.5 });
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.screenshot({ path: 'output/btv-gate-wall-preview.png' }); await page.mouse.up();
  const ordered = await page.evaluate(() => ({ gold: window.__game.state.factions[0].gold,
    walls: window.__game.state.buildings.filter(building => building.kind === 'wall').length }));
  assert.deepEqual(ordered, { gold: 946, walls: 9 });

  // Queued layers already reserve spacing, in both the preview and actual order path.
  await page.locator('[data-build="road"]').click();
  await click({ x: 13.5, y: 12.5 });
  assert.match(await page.locator('#build-status').innerText(), /two wall tiles|cannot touch/i);
  await click({ x: 11.5, y: 9.5 });
  assert.match(await page.locator('#build-status').innerText(), /junctions.*2 tiles/i);
  const rejected = await page.evaluate(() => ({ gold: window.__game.state.factions[0].gold,
    adjacentGate: window.__game.state.buildings.some(b => b.kind === 'road' && b.x === 13 && b.y === 12),
    closeJunction: window.__game.state.buildings.some(b => b.kind === 'road' && b.x === 11 && b.y === 9) }));
  assert.deepEqual(rejected, { gold: 946, adjacentGate: false, closeJunction: false });
  await page.keyboard.press('Escape');
  const completed = await page.evaluate(() => {
    const game = window.__game; game.state.paused = false;
    for (let i = 0; i < 1500 && game.state.buildings.some(b => b.kind === 'wall' && b.construction); i++) game.step(.1);
    game.state.paused = true;
    return !game.state.buildings.some(b => b.kind === 'wall' && b.construction);
  });
  assert.equal(completed, true);
  const passage = await page.evaluate(async () => {
    const { canWalk } = await import('/src/game/pathfinding.ts');
    const state = window.__game.state;
    return { gates: [12, 15].map(x => [0, 1, -2].map(f => canWalk(state, x + .5, 12.5, f))),
      solid: [0, 1, -2].map(f => canWalk(state, 13.5, 12.5, f)) };
  });
  assert.deepEqual(passage, { gates: [[true, false, false], [true, false, false]], solid: [false, false, false] });
  await click({ x: 12.5, y: 12.5 }); await page.waitForTimeout(100);
  assert.equal(await page.locator('#selection-name').innerText(), 'Gate');
  await page.screenshot({ path: 'output/btv-gates.png' });
  const movement = await page.evaluate(async () => {
    const { getLeader, updateGame } = await import('/src/game/simulation.ts');
    const state = window.__game.state, leader = getLeader(state);
    const move = x => {
      Object.assign(leader, { x, y: 13.5, destination: undefined, target: undefined, path: undefined, pathGoal: undefined });
      state.paused = false; updateGame(state, 1, { up: true, down: false, left: false, right: false }); state.paused = true;
      return leader.y;
    };
    return { solid: move(13.5), gate: move(12.5) };
  });
  assert.ok(movement.solid >= 13, JSON.stringify(movement)); assert.ok(movement.gate < 12, JSON.stringify(movement));
  await page.evaluate(() => window.__game.save()); await page.reload({ waitUntil: 'networkidle' });
  const restored = await page.evaluate(async () => {
    const { canWalk } = await import('/src/game/pathfinding.ts'); const state = window.__game.state; state.paused = true;
    return [12, 15].map(x => ({ layers: state.buildings.filter(b => b.x === x && b.y === 12).length, open: canWalk(state, x + .5, 12.5, 0) }));
  });
  assert.deepEqual(restored, [{ layers: 2, open: true }, { layers: 2, open: true }]); assert.deepEqual(errors, []);
  writeFileSync('output/btv-gates-report.json', JSON.stringify({ ordered, rejected, passage, movement, restored, errors }, null, 2));
  console.log('PASS gate spacing and road junction spacing through real drag/click input; rejected orders spend nothing.');
  console.log('PASS peasant-built gates, ownership, solid walls, movement, selection, persistence and browser runtime.');
} finally { await browser.close(); }
