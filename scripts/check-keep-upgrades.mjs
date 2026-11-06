import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-11-03-keep-upgrades'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
page.on('pageerror', error => errors.push(String(error))); await page.routeWebSocket('**', socket => socket.close());
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.evaluate(async () => {
    const width = 32, height = 24, world = { width, height, revision: 1, seed: 'keep-popup', source: 'Isolated Keep review', spawns: [],
      tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 2, production: 1, gold: 0, variation: .5 })) };
    const state = { world, buildings: [{ id: 1, kind: 'palace', faction: 0, x: 13, y: 12, hp: 325, maxHp: 650, capacity: 4,
      unhousedResidents: 4, cityName: 'Roma', governorPermissions: { farms: false, housing: false } }],
      units: [{ id: 10, kind: 'leader', faction: 0, x: 15.5, y: 14.5, hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 4,
        speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
      factions: [{ id: 0, name: 'Romans', color: '#c94c4c', affinity: 100, relation: 'self', population: 4, food: 500, gold: 2000,
        production: 0, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false,
        research: { focus: 'woodenTower', levels: { woodenTower: 1 }, progress: {} } }],
      time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], fields: [], projectiles: [], bloodEffects: [], treasures: [],
      raiderCamps: [], marauderPacks: [], villages: [], treeClearings: [], roamingMaraudersVersion: 1, banditIntensity: 0,
      wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 },
      selected: 10, selectedType: 'unit', buildMode: null, diplomacy: null, gameOver: false, victory: false,
      seed: world.seed, rngState: 1, retinueStance: 'hold', movementMode: 'travel', traffic: {} };
    __game.replaceState(state); __game.renderer.prepare(state); __game.renderer.follow = false;
    __game.renderer.camera = { x: 14, y: 13 }; __game.renderer.zoom = 1.5;
  });
  await page.waitForTimeout(150);
  const point = await page.evaluate(() => __game.renderer.screenPoint({ x: 13.5, y: 12.5 }));
  await page.mouse.click(point.x, point.y);
  const popup = page.locator('#building-activity'); await popup.waitFor({ state: 'visible' });
  await page.locator('[data-keep]').click();
  await page.waitForFunction(() => __game.state.buildings[0].palaceLevel === 2);
  const initial = await page.evaluate(() => ({ building: __game.state.buildings[0], gold: __game.state.factions[0].gold }));
  assert.equal(initial.building.capacity, 10); assert.equal(initial.building.hp, 3250); assert.equal(initial.gold, 2000);
  assert.equal(await page.locator('[data-keep-housing]').isEnabled(), true);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${output}/keep-housing-available.png` });
  await page.locator('[data-keep-housing]').click();
  await page.waitForFunction(() => __game.state.buildings[0].keepHousingExpanded);
  const purchased = await page.evaluate(() => ({ building: __game.state.buildings[0], gold: __game.state.factions[0].gold,
    population: __game.state.factions[0].population, food: __game.state.factions[0].food }));
  assert.equal(purchased.building.capacity, 25); assert.equal(purchased.gold, 1000); assert.equal(purchased.building.hp, 3250);
  assert.equal(purchased.population, 4); assert.equal(purchased.food, 500);
  assert.equal(await page.locator('[data-keep-housing]').isDisabled(), true);
  const measurements = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 750, height: 500 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(150);
    const data = await popup.evaluate(element => { const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
        scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, font: getComputedStyle(element).fontFamily }; });
    assert.ok(data.left >= 0 && data.top >= 0 && data.right <= viewport.width && data.bottom <= viewport.height);
    assert.ok(data.scrollHeight <= data.clientHeight); assert.ok(data.font.includes('Pixel Operator'));
    measurements.push({ viewport, ...data });
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(100);
  await page.screenshot({ path: `${output}/keep-housing-expanded.png` });
  await page.locator('.activity-close').click(); assert.equal(await popup.isVisible(), false);
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/results.json`, JSON.stringify({ initial, purchased, measurements, errors }, null, 2));
  console.log(JSON.stringify({ pass: true, capacity: purchased.building.capacity, gold: purchased.gold, measurements, errors }));
} finally { await browser.close(); }
