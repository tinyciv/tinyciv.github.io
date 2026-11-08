import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const out = process.env.OUTPUT_DIR || 'scratch/2026-11-06-engineering';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [], checks = [];
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`); };
page.on('pageerror', error => errors.push(String(error)));
await page.routeWebSocket('**', socket => socket.close());
await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
const settle = () => page.waitForTimeout(250);
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5189');
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', null, { timeout: 90000 });
  await page.evaluate(() => {
    window.__engineeringImport = async path => {
      const loaded = [...performance.getEntriesByType('resource')].reverse().find(entry => new URL(entry.name).pathname === path);
      return import(loaded?.name ?? path);
    };
    const world = { width: 48, height: 32, seed: 'engineering-browser', source: 'isolated QA', spawns: [], revision: 1,
      tiles: Array.from({ length: 1536 }, (_, cell) => ({ terrain: cell % 48 >= 24 && cell % 48 <= 26 ? 'river' : 'grassland',
        overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) };
    const building = (id, kind, x, y) => ({ id, kind, x, y, faction: 0, hp: 750, maxHp: 750, capacity: 0 });
    const state = { world, buildings: [{ ...building(1, 'palace', 15, 11), cityName: 'Roma', capacity: 20, unhousedResidents: 20,
      governorPermissions: { farms: false, housing: false } }, building(3, 'library', 20, 14)],
      units: [{ id: 500, kind: 'leader', faction: 0, x: 20.5, y: 16.5, hp: 100, maxHp: 100, morale: 100, attack: 20,
        defense: 5, speed: 3.6, range: 4, order: 'hold', retinueStance: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
      factions: [{ id: 0, name: 'Roma', color: '#c94c4c', affinity: 100, relation: 'self', food: 300, gold: 1000, production: 0,
        population: 20, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }],
      time: 0, tick: 0, paused: true, speed: 1, gameOver: false, victory: false, events: [], particles: [], projectiles: [], bloodEffects: [],
      fields: [], treasures: [], raiderCamps: [], marauderPacks: [], treeClearings: [], villages: [], roamingMaraudersVersion: 1,
      fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 }, wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 },
      banditIntensity: 0, selected: 500, selectedType: 'unit', buildMode: null, diplomacy: null, seed: world.seed, rngState: 1,
      retinueStance: 'hold', movementMode: 'travel', traffic: {} };
    __game.replaceState(state); __game.renderer.prepare(state); __game.renderer.follow = false;
    __game.renderer.camera = { x: 22, y: 15 }; __game.renderer.zoom = 1.65;
  });
  await settle();
  const rejected = await page.evaluate(async () => {
    const { planConstruction } = await __engineeringImport('/src/game/construction.ts');
    const { applyGameCommand } = await __engineeringImport('/src/multiplayer/commands.ts');
    const plan = planConstruction(__game.state, 'bridge', [{ x: 25, y: 16 }]);
    const result = applyGameCommand(__game.state, 0, { type: 'build', kind: 'bridge', points: [{ x: 25, y: 16 }] });
    return { plan: plan.ok, message: plan.message, result: result.ok, gold: __game.state.factions[0].gold,
      bridges: __game.state.buildings.filter(building => building.kind === 'bridge').length };
  });
  check('Three-tile bridge preview and authoritative purchase fail before Engineering without spending',
    !rejected.plan && !rejected.result && rejected.gold === 1000 && rejected.bridges === 0 && rejected.message.includes('Engineering'));
  const point = await page.evaluate(() => __game.renderer.screenPoint({ x: 20.5, y: 14.5 }));
  await page.mouse.click(point.x, point.y); await page.locator('.research-node[data-research="engineering"]').waitFor({ state: 'visible' });
  await page.locator('.research-node[data-research="engineering"]').click(); await settle();
  check('Engineering node selects its correct description and price',
    await page.locator('.research-tech').textContent() === 'Engineering'
      && (await page.locator('.research-effect').textContent()).includes('8 water tiles')
      && (await page.locator('.research-node[data-research="engineering"] .research-cost-number').textContent()) === '126');
  check('Engineering icon resolves to loaded existing artwork', await page.locator('.research-node[data-research="engineering"] img').evaluate(image => image.complete && image.naturalWidth > 0));
  await page.locator('.research-prioritize').click();
  await page.locator('[name="research-allocation"]').focus(); await page.keyboard.press('End'); await settle();
  const initial = await page.evaluate(async () => (await __engineeringImport('/src/game/research.ts')).researchStatus(__game.state, 0));
  check('Prioritizing Engineering queues Fortification first and permits 100% research funding',
    initial.requestedFocus === 'engineering' && initial.focus === 'woodenTower' && initial.allocation === 1);
  await page.screenshot({ path: `${out}/engineering-prioritized.png` });
  const completed = [];
  for (const expected of ['woodenTower', 'wall', 'engineering']) {
    const current = await page.evaluate(async () => (await __engineeringImport('/src/game/research.ts')).researchStatus(__game.state, 0));
    check(`Research resolves ${expected} in prerequisite order`, current.focus === expected);
    await page.evaluate(async () => {
      const { researchStatus, updateResearch } = await __engineeringImport('/src/game/research.ts');
      const { grantIncome } = await __engineeringImport('/src/game/resource-income.ts');
      const state = __game.state, status = researchStatus(state, 0);
      grantIncome(state.factions[0], { gold: status.required - status.progress }, state);
      state.paused = false; updateResearch(state, 1000); state.paused = true;
    });
    await settle(); completed.push(expected);
  }
  check('Engineering completes through paid income and retains both prerequisites', await page.evaluate(() =>
    ['woodenTower', 'wall', 'engineering'].every(id => __game.state.factions[0].research.levels[id] === 1)));
  await page.locator('.research-node[data-research="engineering"]').click(); await settle();
  await page.screenshot({ path: `${out}/engineering-complete.png` });
  const constructed = await page.evaluate(async () => {
    const { planConstruction } = await __engineeringImport('/src/game/construction.ts');
    const { applyGameCommand } = await __engineeringImport('/src/multiplayer/commands.ts');
    const state = __game.state, before = state.factions[0].gold;
    const plan = planConstruction(state, 'bridge', [{ x: 25, y: 16 }]);
    const result = applyGameCommand(state, 0, { type: 'build', kind: 'bridge', points: [{ x: 25, y: 16 }] });
    return { ok: plan.ok && result.ok, cost: plan.cost, spent: before - state.factions[0].gold,
      bridges: state.buildings.filter(building => building.kind === 'bridge').map(building => ({ x: building.x, y: building.y, queued: !!building.construction })) };
  });
  check('The same rejected crossing refreshes after research and buys all three queued segments',
    constructed.ok && constructed.cost === 30 && constructed.spent === 30 && constructed.bridges.length === 3
      && constructed.bridges.every(building => building.y === 16 && building.queued)
      && constructed.bridges.map(building => building.x).sort().join() === '24,25,26');
  check('No runtime errors', errors.length === 0);
  await writeFile(`${out}/browser-report.json`, JSON.stringify({ checks, completed, rejected, constructed, errors }, null, 2));
} finally { await browser.close(); }
