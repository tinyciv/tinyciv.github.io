import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = process.env.OUTPUT_DIR || '/private/tmp/tinyciv-fertility-visuals';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5189');
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', null, { timeout: 90000 });
  const result = await page.evaluate(async () => {
    const { createGame, getLeader } = await import('/src/game/simulation.ts');
    const { entityStore } = await import('/src/game/entity-store.ts');
    const { applySoilFertility } = await import('/src/world/soil.ts');
    const { recordUnitDamage, damageNumberStyle } = await import('/src/game/combat-feedback.ts');
    const world = { width: 60, height: 40, seed: 'fertility-visual', source: 'fixture', spawns: [{ x: 28, y: 24 }],
      tiles: Array.from({ length: 2400 }, (_, i) => ({ terrain: i % 60 < 26 ? 'grassland' : i % 60 < 34 ? 'plains' : 'desert',
        overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) };
    for (let y = 0; y < 40; y++) world.tiles[y * 60 + 42].terrain = 'river';
    applySoilFertility(world);
    const state = createGame(world), leader = getLeader(state);
    state.paused = true; state.time = 100; state.particles = []; state.fields = [];
    state.factions = [0, 1, 2].map((id) => ({ ...structuredClone(state.factions[0]), id, name: `Faction ${id}`,
      color: ['#d94d4d', '#3988ff', '#60ad60'][id], relation: id ? 'war' : 'self' }));
    Object.assign(leader, { x: 30.5, y: 23.5, hp: 90, maxHp: 100 });
    const friend = { ...structuredClone(leader), id: 501, kind: 'warrior', x: 27.5, y: 23.5, hp: 73 };
    const enemy = { ...structuredClone(friend), id: 502, faction: 1, x: 34.5, y: 23.5 };
    entityStore(state).units.replace([leader, friend, enemy]);
    entityStore(state).buildings.replace([0, 1, 2].map((faction) => ({ id: 600 + faction, kind: 'fort', faction,
      x: 24 + faction * 6, y: 19, hp: 1000, maxHp: 1000, armor: 2, capacity: 0 })));
    recordUnitDamage(state, friend, 90); recordUnitDamage(state, enemy, 90);
    state.particles.push({ x: 30.5, y: 21.5, text: '+200 gold', color: '#ffe33d', life: 1.2, duration: 1.6 });
    window.__game.replaceState(state);
    const renderer = window.__game.renderer; renderer.camera = { x: 31, y: 21 }; renderer.follow = false; renderer.zoom = 2.2;
    return { friendly: damageNumberStyle(state, state.particles[0]), enemy: damageNumberStyle(state, state.particles[1]),
      fertility: [world.tiles[15 * 60 + 23].fertility, world.tiles[15 * 60 + 30].fertility, world.tiles[15 * 60 + 35].fertility, world.tiles[15 * 60 + 41].fertility] };
  });
  assert.deepEqual(result.friendly, { text: '-17', color: '#ff5252' });
  assert.deepEqual(result.enemy, { text: '17', color: '#ffffff' });
  assert.deepEqual(result.fertility, [1, .75, .5, .75]);
  checks.push('Friendly damage red, enemy damage white without a sign', 'Grass/plains/desert/freshwater fertility matches the requested rules');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${output}/fort-roofs-terrain-combat.png` });
  assert.deepEqual(errors, []);
  checks.push('Integrated renderer has no browser errors');
  console.log(JSON.stringify({ checks, result, errors }, null, 2));
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, result, errors }, null, 2));
} finally { await browser.close(); }
