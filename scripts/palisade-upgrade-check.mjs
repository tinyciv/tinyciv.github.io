import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-11-01-palisade-upgrades';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const checks = [], errors = [];
const check = (name, value, detail) => { checks.push({ name, passed: !!value, detail }); assert.ok(value, name); };
page.on('pageerror', error => errors.push(String(error)));
const settle = () => page.waitForTimeout(180);
const screen = point => page.evaluate(point => __game.renderer.screenPoint(point), point);
const clickTile = async point => { const p = await screen(point); await page.mouse.click(p.x, p.y); await settle(); };
async function finishOrders() {
  return page.evaluate(async () => {
    const { ensureBuilders, updateBuilder } = await import('/src/game/builders.ts');
    const { updateConstruction } = await import('/src/game/structures.ts');
    const { moveUnit } = await import('/src/game/simulation.ts');
    const s = __game.state, start = s.time;
    const pending = () => s.buildings.filter(b => b.kind === 'wall' && b.construction);
    for (let i = 0; i < 900 && pending().length; i++) {
      s.time += .1; ensureBuilders(s);
      for (const worker of [...s.units]) if (worker.builder && worker.hp > 0) updateBuilder(s, worker, .1, moveUnit);
      updateConstruction(s);
    }
    return { seconds: s.time - start, unfinished: pending().map(b => ({ id: b.id, site: b.construction })) };
  });
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { updateFog } = await import('/src/game/fog.ts');
    const building = (id, kind, x, y, extra = {}) => ({ id, kind, faction: 0, x, y,
      hp: kind === 'palisade' ? 56.25 : 650, maxHp: kind === 'palisade' ? 56.25 : 650, armor: 2, capacity: 0, ...extra });
    let id = 100;
    const defenses = [];
    for (let y = 10; y <= 18; y++) for (let x = 10; x <= 22; x++)
      if ((x === 10 || x === 22 || y === 10 || y === 18) && !(x === 15 && y === 10))
        defenses.push(building(id++, 'palisade', x, y));
    const state = {
      world: { width: 40, height: 30, seed: 'palisade-upgrade-browser', source: 'isolated QA', spawns: [], revision: 1,
        tiles: Array.from({ length: 1200 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
          moisture: .7, food: 3, production: 1, gold: 0, variation: (i % 13) / 13 })) },
      buildings: [building(1, 'palace', 14, 14, { cityName: 'Roma', initialCity: true, capacity: 20, unhousedResidents: 20,
        governorPermissions: { farms: false, housing: false } }), ...defenses,
        building(2, 'woodenTower', 14, 10, { hp: 600, maxHp: 600 }),
        building(3, 'road', 18, 10), building(4, 'road', 18, 9), building(5, 'road', 18, 11)],
      units: [{ id: 10, kind: 'leader', faction: 0, x: 18.5, y: 13.5, hp: 100, maxHp: 100, morale: 100,
        attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60,
        moving: false, facing: 0, attackTime: 0 }],
      factions: [{ id: 0, name: 'Romans', color: '#ee3434', affinity: 100, relation: 'self', food: 500,
        gold: 3, population: 20, production: 0, culture: 10000, yields: { food: 0, gold: 20, production: 0 },
        nextRaid: Infinity, defeated: false, research: { focus: 'wall', levels: { woodenTower: 1, wall: 1 }, progress: {} } }],
      time: 10, tick: 0, paused: true, speed: 1, events: [], particles: [], projectiles: [], bloodEffects: [], fields: [],
      treeClearings: [], selected: 10, selectedType: 'unit', buildMode: null, diplomacy: null, gameOver: false, victory: false,
      seed: 'palisade-upgrade-browser', rngState: 1, raiderCamps: [], marauderPacks: [], treasures: [], villages: [],
      fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 }, roamingMaraudersVersion: 1,
    };
    __game.replaceState(state); updateFog(state); __game.renderer.prepare(state);
    __game.renderer.zoom = 1.65; __game.renderer.camera = { x: 16.5, y: 13 }; __game.renderer.follow = false;
  });
  await settle(); await page.keyboard.press('f'); await settle();
  const wallButton = page.locator('[data-build="wall"]');
  check('stone wall button is available with exactly 3 gold', await wallButton.isEnabled());
  check('wall tooltip describes the 3-gold palisade upgrade', (await wallButton.getAttribute('title')).includes('3 gold over a palisade'));
  await wallButton.click();
  check('button selects the stone wall placement tool', await page.evaluate(() => __game.state.buildMode === 'wall'));
  const gatePoint = { x: 18.5, y: 10.5 }, gateScreen = await screen(gatePoint);
  await page.mouse.move(gateScreen.x, gateScreen.y); await settle();
  const preview = await page.evaluate(async () => {
    const { planConstruction } = await import('/src/game/construction.ts');
    const s = __game.state, before = JSON.stringify(s.buildings), gold = s.factions[0].gold;
    const plan = planConstruction(s, 'wall', [{ x: 18, y: 10 }]);
    return { ok: plan.ok, cost: plan.cost, unchanged: JSON.stringify(s.buildings) === before && s.factions[0].gold === gold };
  });
  check('gate upgrade preview costs 3 and does not mutate the live scene', preview.ok && preview.cost === 3 && preview.unchanged, preview);
  await page.screenshot({ path: `${output}/gate-upgrade-preview.png` });
  await clickTile(gatePoint);
  const ordered = await page.evaluate(() => {
    const s = __game.state, wall = s.buildings.find(b => b.kind === 'wall' && b.x === 18 && b.y === 10);
    return { gold: s.factions[0].gold, wall, original: s.buildings.find(b => b.id === wall?.construction?.replacesPalisade), road: s.buildings.find(b => b.id === 3) };
  });
  check('actual map click orders the 3-gold upgrade and keeps the old gate', ordered.gold === 0 && ordered.wall?.construction?.paidGold === 3 && ordered.original?.kind === 'palisade' && !!ordered.road, ordered);
  await page.screenshot({ path: `${output}/gate-upgrade-queued.png` });
  const canceled = await page.evaluate(async id => {
    const { cancelConstruction } = await import('/src/game/simulation.ts');
    const s = __game.state, result = cancelConstruction(s, id);
    return { result, gold: s.factions[0].gold, original: s.buildings.some(b => b.kind === 'palisade' && b.x === 18 && b.y === 10), road: s.buildings.some(b => b.id === 3) };
  }, ordered.wall.id);
  check('cancel refunds only the 3-gold order and preserves palisade and road', canceled.result.ok && canceled.result.refund === 3 && canceled.gold === 3 && canceled.original && canceled.road, canceled);
  await settle(); await clickTile(gatePoint);
  const gateWork = await finishOrders();
  check('a real settlement builder finishes the replacement', gateWork.unfinished.length === 0 && gateWork.seconds >= 4, gateWork);
  const gate = await page.evaluate(async () => {
    const { canWalk } = await import('/src/game/pathfinding.ts');
    const { gateConnections, indexBuildings } = await import('/src/game/renderer.ts');
    const s = __game.state, wall = s.buildings.find(b => b.kind === 'wall' && b.x === 18 && b.y === 10);
    return { complete: !!wall && !wall.construction, oldRemoved: !s.buildings.some(b => b.kind === 'palisade' && b.x === 18 && b.y === 10),
      road: s.buildings.some(b => b.id === 3), friendly: canWalk(s, 18.5, 10.5, 0), enemy: canWalk(s, 18.5, 10.5, -2),
      links: wall && gateConnections(wall, indexBuildings(s.buildings), s.world) };
  });
  check('finished gate retains its road and friendly passage, blocks enemies', gate.complete && gate.oldRemoved && gate.road && gate.friendly && !gate.enemy && gate.links?.north && gate.links?.south, gate);
  await page.evaluate(() => { __game.state.factions[0].gold = 12; }); await settle();
  const mixed = await page.evaluate(async () => {
    const { planConstruction } = await import('/src/game/construction.ts');
    const p = planConstruction(__game.state, 'wall', [{ x: 14, y: 10 }, { x: 15, y: 10 }, { x: 16, y: 10 }]);
    return { ok: p.ok, cost: p.cost, cells: p.cells };
  });
  check('mixed stroke costs 3 + 6 + 3 gold', mixed.ok && mixed.cost === 12 && mixed.cells.every(c => c.ok), mixed);
  const from = await screen({ x: 14.5, y: 10.5 }), to = await screen({ x: 16.5, y: 10.5 });
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up(); await settle();
  const stroke = await page.evaluate(() => ({ gold: __game.state.factions[0].gold,
    orders: __game.state.buildings.filter(b => b.kind === 'wall' && b.y === 10 && b.x >= 14 && b.x <= 16).map(b => ({ x: b.x, paid: b.construction?.paidGold })) }));
  check('actual drag places both upgrades and the new wall for 12 gold', stroke.gold === 0 && stroke.orders.length === 3 && stroke.orders.reduce((s, b) => s + b.paid, 0) === 12, stroke);
  const strokeWork = await finishOrders();
  check('all mixed-stroke orders finish using real builders', strokeWork.unfinished.length === 0, strokeWork);
  const tower = await page.evaluate(async () => {
    const { canWalk } = await import('/src/game/pathfinding.ts');
    const s = __game.state;
    return { tower: s.buildings.find(b => b.id === 2), wall: s.buildings.find(b => b.kind === 'wall' && b.x === 14 && b.y === 10),
      old: s.buildings.some(b => b.kind === 'palisade' && b.x === 14 && b.y === 10), walkable: canWalk(s, 14.5, 10.5, 0) };
  });
  check('mounted tower survives unchanged above its completed stone wall', tower.tower?.hp === 600 && tower.wall && !tower.wall.construction && !tower.old && !tower.walkable, tower);
  await page.keyboard.press('Escape'); await settle();
  await page.screenshot({ path: `${output}/completed-stone-upgrades.png` });
  check('no browser errors', errors.length === 0, errors);
} finally {
  writeFileSync(`${output}/browser-report.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
