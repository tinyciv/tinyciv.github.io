import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';

// The governor's real single-cell siting planner runs repeatedly against the
// previous orders. Completing those orders directly isolates layout scoring
// from the unrelated delivery, building, population, and combat clocks.
const output = 'scratch/2026-11-03-farm-squares';
mkdirSync(output, { recursive: true });
const before = 'scratch/2026-11-03-farm-blocks/generated-starting-farms.png';
if (existsSync(before) && !existsSync(`${output}/generated-before.png`)) copyFileSync(before, `${output}/generated-before.png`);
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const checks = [], errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.routeWebSocket('**', socket => socket.close());
const check = (label, value, data) => {
  checks.push({ label, pass: !!value, data }); console.log(label, !!value, JSON.stringify(data));
};

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.evaluate(() => {
    window.__farmGeometry = (farms, width) => {
      const cells = new Set(farms.map(farm => farm.y * width + farm.x)), remaining = new Set(cells), blocks = [];
      while (remaining.size) {
        const queue = [remaining.values().next().value]; remaining.delete(queue[0]);
        for (let i = 0; i < queue.length; i++) {
          const cell = queue[i], x = cell % width;
          for (const other of [cell - width, cell + width, ...(x ? [cell - 1] : []), ...(x < width - 1 ? [cell + 1] : [])])
            if (remaining.delete(other)) queue.push(other);
        }
        const xs = queue.map(cell => cell % width), ys = queue.map(cell => Math.floor(cell / width));
        const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
        blocks.push({ size: queue.length, width: w, height: h, x: Math.min(...xs), y: Math.min(...ys),
          square: w === h && (w === 2 || w === 3) && queue.length === w * h });
      }
      const squares = blocks.filter(block => block.square), squarePlots = squares.reduce((sum, block) => sum + block.size, 0);
      return { plots: farms.length, blocks, squares2: squares.filter(block => block.width === 2).length,
        squares3: squares.filter(block => block.width === 3).length, otherBlocks: blocks.length - squares.length,
        squarePlots, squarePlotFraction: squarePlots / Math.max(1, farms.length) };
    };
  });

  const flat = await page.evaluate(async () => {
    const world = { width: 80, height: 60, seed: 'farm-square-browser-flat', source: 'isolated uniform QA map', spawns: [], revision: 1,
      tiles: Array.from({ length: 4800 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5,
        food: 2, production: 1, gold: 0, variation: i % 13 / 13 })) };
    const palace = { id: 1, kind: 'palace', faction: 0, x: 40, y: 30, hp: 650, maxHp: 650, capacity: 20,
      unhousedResidents: 20, cityName: 'Roma', governorPermissions: { farms: true, housing: false } };
    const s = { world, buildings: [palace],
      units: [{ id: 10, kind: 'leader', x: 41, y: 32.5, faction: 0, hp: 100, maxHp: 100, morale: 100, attack: 0,
        defense: 4, speed: 0, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0 }],
      factions: [{ id: 0, name: 'Romans', color: '#c94c4c', affinity: 100, relation: 'self', food: 1000, gold: 5000, production: 0,
        population: 20, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }],
      time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], fields: [], projectiles: [], bloodEffects: [], treasures: [],
      raiderCamps: [], marauderPacks: [], villages: [], treeClearings: [], roamingMaraudersVersion: 1,
      wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, banditIntensity: 0,
      fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 }, selected: 10, selectedType: 'unit', buildMode: null, diplomacy: null,
      gameOver: false, victory: false, victoryContinued: true, seed: world.seed, rngState: 1, retinueStance: 'hold', movementMode: 'travel', traffic: {} };
    __game.replaceState(s);
    const { entityStore } = await import('/src/game/entity-store.ts');
    const { planAutomaticFarmSite } = await import('/src/game/farm-siting.ts');
    const { farmBlockPlacementQuery } = await import('/src/game/farm-blocks.ts');
    const { synchronizeFarms } = await import('/src/game/farms.ts');
    const { updateFog } = await import('/src/game/fog.ts');
    const placements = [], snapshots = [], timings = []; let allStepsLegal = true;
    for (let n = 1; n <= 60; n++) {
      const started = performance.now(), site = planAutomaticFarmSite(s, palace); timings.push(performance.now() - started);
      if (!site) throw Error(`Automatic siting stopped at plot ${n}`);
      const validation = farmBlockPlacementQuery(s).canAdd(site.point); allStepsLegal &&= validation.ok;
      if (!validation.ok) throw Error(`Automatic siting selected illegal plot: ${validation.message}`);
      entityStore(s).buildings.add({ id: 100 + n, kind: 'camp', faction: 0, ...site.point, hp: 100, maxHp: 100, capacity: 0 });
      s.world.revision++; placements.push(site);
      if (n % 10 === 0) snapshots.push({ count: n, ...window.__farmGeometry(s.buildings.filter(b => b.kind === 'camp'), world.width) });
    }
    synchronizeFarms(s); __game.replaceState(s); updateFog(s);
    __game.renderer.prepare(s); __game.renderer.follow = false; __game.renderer.camera = { x: 41, y: 30 }; __game.renderer.zoom = 1.25;
    for (let i = 0; i < 18; i++) __game.renderer.draw(s, .05);
    timings.sort((a, b) => a - b);
    return { ...window.__farmGeometry(s.buildings.filter(b => b.kind === 'camp'), world.width), allStepsLegal, snapshots, placements,
      fieldCount: s.fields.length, plannerMedianMs: timings[Math.floor(timings.length / 2)], plannerMaxMs: timings.at(-1) };
  });
  await page.waitForTimeout(200); await page.screenshot({ path: `${output}/automatic-flat-60-plots.png` });
  check('sixty sequential automatic orders retain the hard geometry rules', flat.plots === 60 && flat.fieldCount === 60 && flat.allStepsLegal,
    { plots: flat.plots, fieldCount: flat.fieldCount, allStepsLegal: flat.allStepsLegal });
  check('most automatically selected plots finish 2×2 or 3×3 squares', flat.squarePlotFraction >= .6,
    { squares2: flat.squares2, squares3: flat.squares3, otherBlocks: flat.otherBlocks, squarePlotFraction: flat.squarePlotFraction });
  writeFileSync(`${output}/flat-layout.json`, JSON.stringify(flat, null, 2));

  const generated = await page.evaluate(async () => {
    const { generateWorld } = await import('/src/world/generator.ts'), { createGame } = await import('/src/game/simulation.ts');
    const { farmBlockPlacementQuery } = await import('/src/game/farm-blocks.ts');
    const s = createGame(generateWorld('farm-block-browser-final')); s.paused = true; __game.replaceState(s);
    const farms = s.buildings.filter(b => b.kind === 'camp' && b.hp > 0), playerFarms = farms.filter(b => b.faction === 0);
    const home = s.buildings.find(b => b.kind === 'palace' && b.faction === 0);
    __game.renderer.prepare(s); __game.renderer.follow = false; __game.renderer.camera = { x: home.x + 1, y: home.y + 1 }; __game.renderer.zoom = 1;
    for (let i = 0; i < 18; i++) __game.renderer.draw(s, .05);
    return { seed: s.world.seed, population: s.factions[0].population, all: window.__farmGeometry(farms, s.world.width),
      player: window.__farmGeometry(playerFarms, s.world.width), validation: farmBlockPlacementQuery(s).canAddAll(farms) };
  });
  await page.waitForTimeout(200); await page.screenshot({ path: `${output}/generated-after.png` });
  check('the same generated seed preserves valid starting farm geometry', generated.population === 20 && generated.all.plots > 20 && generated.validation.ok,
    { seed: generated.seed, population: generated.population, allPlots: generated.all.plots, player: generated.player });
  writeFileSync(`${output}/generated-layout.json`, JSON.stringify(generated, null, 2));
  check('no browser runtime errors', errors.length === 0, errors);
  assert.ok(checks.every(check => check.pass), JSON.stringify(checks.filter(check => !check.pass)));
  rmSync(`${output}/failure.png`, { force: true });
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); throw error;
} finally {
  writeFileSync(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2)); await browser.close();
}
