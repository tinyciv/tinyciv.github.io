import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: existsSync(chrome) ? chrome : undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const clickWorld = async (point, button = 'left') => {
  const screen = await page.evaluate(p => window.__game.renderer.screenPoint(p), point);
  await page.mouse.click(screen.x, screen.y, { button });
};
async function fixture() {
  await page.evaluate(async () => {
    const { createGame, getLeader } = await import('/src/game/simulation.ts');
    const world = { width: 48, height: 40, seed: 'orders-browser', source: 'test', spawns: [{ x: 18, y: 18 }],
      tiles: Array.from({ length: 1920 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .6, variation: .4, food: 2, production: 2, gold: 1 })) };
    const state = createGame(world), leader = getLeader(state);
    window.__game.entities(state).units.replace(state.units.filter(unit => unit.faction === 0));
    state.marauderPacks = []; state.raiderCamps = []; state.paused = true;
    Object.assign(leader, { x: 20.5, y: 20.5, target: undefined, destination: undefined, path: undefined });
    state.selected = leader.id; state.selectedType = 'unit';
    const soldiers = state.units.filter(unit => unit.kind === 'warrior');
    soldiers.forEach((unit, i) => Object.assign(unit, { x: 18.5, y: 20.5 + i * 2 }));
    window.__game.replaceState(state);
    window.__game.renderer.prepare(window.__game.state);
    window.__game.renderer.center(window.__game.state);
    window.__game.renderer.zoom = 1.7;
  });
}

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready');
  if (await page.locator('#dialog').isVisible()) await page.keyboard.press('Escape');
  await fixture();
  for (const expected of ['defensive', 'hold', 'aggressive']) {
    await page.keyboard.press('q');
    assert.equal(await page.evaluate(() => window.__game.state.retinueStance), expected);
    assert.ok(await page.evaluate(stance => window.__game.state.units.filter(unit => unit.faction === 0 && unit.kind === 'warrior').every(unit => unit.retinueStance === stance), expected));
  }
  await page.keyboard.press('Shift');
  assert.deepEqual(await page.evaluate(() => ({ mode: window.__game.state.movementMode, marker: window.__game.renderer.movementModeMarker?.mode })), { mode: 'formation', marker: 'formation' });
  assert.doesNotMatch(await page.locator('.hud').innerText(), /Formation|Travel/);
  mkdirSync('output', { recursive: true });
  await page.screenshot({ path: 'output/btv-formation-command.png' });
  await page.waitForFunction(() => window.__game.renderer.movementModeMarker === null);
  await page.keyboard.press('Shift');
  assert.deepEqual(await page.evaluate(() => ({ mode: window.__game.state.movementMode, marker: window.__game.renderer.movementModeMarker?.mode })), { mode: 'travel', marker: 'travel' });
  console.log('PASS entire-retinue Q cycle; Shift modes and brief paused-time icon without panel labels');

  await page.evaluate(() => { window.__game.state.factions[0].gold = 50; window.__game.state.factions[0].population = 29; });
  assert.equal(await page.locator('[data-action="clear"]').isEnabled(), true);
  await page.keyboard.press('b');
  await page.waitForFunction(() => document.querySelector('[data-build="well"]').disabled);
  const gray = await page.locator('[data-build="well"]').evaluate(element => ({ opacity: getComputedStyle(element).opacity, filter: getComputedStyle(element).filter }));
  assert.ok(Number(gray.opacity) < 1 || gray.filter.includes('grayscale'));
  await page.evaluate(() => { window.__game.state.factions[0].gold = 49; window.__game.state.factions[0].population = 30; });
  await page.waitForFunction(() => document.querySelector('[data-build="well"]').disabled);
  await page.evaluate(() => { window.__game.state.factions[0].gold = 50; });
  await page.waitForFunction(() => !document.querySelector('[data-build="well"]').disabled);
  await page.keyboard.press('l');
  assert.equal(await page.evaluate(() => window.__game.state.buildMode), 'well');
  await page.screenshot({ path: 'output/btv-well-build-menu.png' });
  const wellSite = await page.evaluate(async () => {
    const { validateBuildAt } = await import('/src/game/simulation.ts');
    const state = window.__game.state;
    for (let y = 15; y < 26; y++) for (let x = 15; x < 26; x++)
      if (validateBuildAt(state, 'well', x, y).ok && state.buildings.some(building => building.kind === 'house' && Math.hypot(building.x - x, building.y - y) <= 8)) return { x: x + .5, y: y + .5 };
  });
  assert.ok(wellSite);
  await clickWorld(wellSite);
  assert.equal(await page.evaluate(() => window.__game.state.factions[0].gold), 0);
  const builtWell = await page.evaluate(() => {
    const game = window.__game, state = game.state;
    const well = state.buildings.find(building => building.kind === 'well');
    state.paused = false;
    for (let i = 0; i < 1000 && well.construction; i++) game.step(.1);
    state.paused = true;
    return { complete: !well.construction, upgrades: state.buildings.filter(building => building.kind === 'house' && building.faction === well.faction && building.houseLevel === 2 && Math.hypot(building.x - well.x, building.y - well.y) <= 8).length };
  });
  assert.equal(builtWell.complete, true); assert.ok(builtWell.upgrades > 0);
  await page.keyboard.press('c');
  assert.equal(await page.locator('.game-area').getAttribute('data-area-tool'), 'clear');
  const tree = await page.evaluate(async () => {
    const { validateTreeClearing } = await import('/src/game/tree-clearing.ts');
    const state = window.__game.state, palace = state.buildings.find(building => building.kind === 'palace');
    for (let y = 15; y < 26; y++) for (let x = 15; x < 27; x++) {
      if (Math.hypot(x - palace.x, y - palace.y) < 7) continue;
      const tile = state.world.tiles[y * state.world.width + x];
      tile.overlay = 'forest';
      state.world.revision = (state.world.revision ?? 0) + 1;
      if (validateTreeClearing(state, x, y).ok) {
        return { x: x + .5, y: y + .5, cell: y * state.world.width + x };
      }
      tile.overlay = 'none';
      state.world.revision++;
    }
  });
  assert.ok(tree);
  await clickWorld(tree);
  assert.equal(await page.evaluate(() => window.__game.state.treeClearings?.length), 1);
  const cleared = await page.evaluate(cell => {
    const game = window.__game, state = game.state;
    let sawPeasant = false;
    state.paused = false;
    for (let i = 0; i < 800 && state.world.tiles[cell].overlay !== 'none'; i++) {
      game.step(.1);
      sawPeasant ||= state.units.some(unit => unit.builder && unit.clearTree && !unit.inside);
    }
    state.paused = true;
    return { sawPeasant, overlay: state.world.tiles[cell].overlay };
  }, tree.cell);
  assert.deepEqual(cleared, { sawPeasant: true, overlay: 'none' });
  await page.keyboard.press('Escape');
  console.log('PASS well affordability, actual peasant-built well upgrades, and click-to-clear tree with walking peasant');

  await fixture();
  const enemy = await page.evaluate(() => {
    const state = window.__game.state, soldier = state.units.find(unit => unit.kind === 'warrior');
    const enemy = { ...soldier, id: 90000, faction: -2, x: 24.5, y: 20.5, hp: 100, maxHp: 100, order: 'hold', retinueStance: undefined, defensiveAnchor: undefined, marauderPack: 90001, kills: 100 };
    window.__game.entities(state).units.add(enemy);
    state.marauderPacks.push({ id: 90001, name: 'Test marauders', color: '#a46433', targetFaction: 0, home: { x: 24.5, y: 20.5 }, waypoint: { x: 24.5, y: 20.5 }, nextWanderAt: 1000 });
    return { x: enemy.x, y: enemy.y, id: enemy.id };
  });
  await clickWorld(enemy, 'right');
  assert.ok(await page.evaluate(id => window.__game.state.units.filter(unit => unit.faction === 0 && ['leader', 'warrior'].includes(unit.kind)).every(unit => unit.forcedAttack?.target === id), enemy.id));
  await page.screenshot({ path: 'output/btv-forced-attack-veterancy.png' });
  console.log('PASS actual right-click enemy input orders Leader and whole retinue');
  await page.evaluate(() => window.__game.save());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready');
  assert.equal(await page.evaluate(() => window.__game.state.units.find(unit => unit.id === 90000)?.kills), 100);
  assert.equal(await page.evaluate(() => window.__game.state.movementMode), 'travel');
  assert.equal(await page.evaluate(() => window.__game.state.retinueStance), 'aggressive');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('b');
  await page.screenshot({ path: 'output/btv-expanded-build-menu-mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS persistence, responsive build menu, and no browser runtime errors');
} finally {
  await browser.close();
}
