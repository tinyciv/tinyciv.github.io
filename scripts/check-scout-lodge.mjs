import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = process.env.SCOUT_QA_OUTPUT || 'scratch/2026-11-05-scout-lodge-no-autoscouts';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const checks = [], errors = [];
const check = (label, pass, data) => { checks.push({ label, pass: !!pass, data }); console.log(label, !!pass); assert.ok(pass, `${label}: ${JSON.stringify(data)}`); };
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', error => errors.push(String(error)));
// A fresh browser context never reads or modifies the user's live settlement.
await page.routeWebSocket('**', socket => socket.close());
const settle = () => page.waitForTimeout(160), popup = page.locator('#building-activity');
const ready = () => page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', undefined, { timeout: 60000 });
async function simulate(seconds) {
  await page.evaluate(seconds => {
    const s = __game.state; s.paused = false;
    for (let elapsed = 0; elapsed < seconds - 1e-7; elapsed += .1) __game.step(Math.min(.1, seconds - elapsed));
    s.paused = true;
  }, seconds); await settle();
}
async function openLodge(id) {
  if (await popup.isVisible()) await page.locator('.activity-close').click();
  const point = await page.evaluate(id => {
    const s = __game.state, b = s.buildings.find(b => b.id === id), leader = s.units.find(u => u.kind === 'leader' && u.faction === 0);
    Object.assign(leader, { x: b.x + .5, y: b.y + 2.5 }); delete leader.path; delete leader.destination;
    __game.renderer.camera = { x: b.x + 1, y: b.y + 1 }; __game.renderer.follow = false;
    return __game.renderer.screenPoint({ x: b.x + .55, y: b.y + .55 });
  }, id); await settle(); await page.mouse.click(point.x, point.y); await popup.waitFor({ state: 'visible' }); await settle();
}
const scoutState = () => page.evaluate(() => __game.state.units.filter(u => u.kind === 'scout' && u.hp > 0)
  .map(u => ({ id: u.id, x: u.x, y: u.y, observationPost: !!u.observationPost })));

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' }); await ready();
  await page.evaluate(async () => {
    const world = { width: 96, height: 64, seed: 'scout-lodge-no-autoscouts', source: 'isolated QA', spawns: [], revision: 1,
      tiles: Array.from({ length: 6144 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .7,
        food: 3, production: 1, gold: 0, variation: i % 13 / 13 })) };
    const building = (id, kind, x, y, extra = {}) => ({ id, kind, x, y, faction: 0, hp: 250, maxHp: 250, capacity: 0, ...extra });
    const person = (id, kind, x, y) => ({ id, kind, x, y, faction: 0, hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 4,
      speed: kind === 'leader' ? 0 : 3.96, range: 1.1, order: 'hold', retinueStance: 'hold', cooldown: 0, lastCombat: -60,
      lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0, home: 1 });
    const state = { world, buildings: [building(1, 'palace', 15, 30, { cityName: 'Roma', capacity: 4, unhousedResidents: 4,
      governorPermissions: { farms: false, housing: false } }), building(3, 'library', 18, 28), building(5, 'archeryRange', 18, 35),
      ...[[13, 29], [13, 31], [15, 33], [18, 32]].map(([x, y], i) => building(10 + i, 'house', x, y, { capacity: 4, residents: 4 }))],
      units: [person(500, 'leader', 22.5, 33.5), ...Array.from({ length: 5 }, (_, i) => person(501 + i, 'warrior', 14.5 + i, 27.5))],
      factions: [{ id: 0, name: 'Romans', color: '#c94c4c', affinity: 100, relation: 'self', food: 0, gold: 2000, production: 0,
        population: 20, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false,
        research: { focus: 'wall', levels: { scoutLodge: 1, archeryRange: 1 }, progress: {}, autoResearch: false } }],
      time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], fields: [], projectiles: [], bloodEffects: [], treasures: [],
      raiderCamps: [], marauderPacks: [], villages: [], treeClearings: [], roamingMaraudersVersion: 1,
      wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, banditIntensity: 0,
      fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 }, selected: 500, selectedType: 'unit', buildMode: null, diplomacy: null,
      gameOver: false, victory: false, victoryContinued: true, seed: world.seed, rngState: 1, retinueStance: 'hold', movementMode: 'travel', traffic: {} };
    __game.replaceState(state);
    const { updateFog } = await import('/src/game/fog.ts'); updateFog(state);
    __game.renderer.prepare(state); __game.renderer.follow = false; __game.renderer.camera = { x: 21, y: 31 }; __game.renderer.zoom = 1.65;
  }); await settle();
  await page.keyboard.press('f'); await settle();
  check('observation posts are locked before a lodge is completed', await page.locator('[data-build="observationPost"]').isDisabled());
  await page.keyboard.press('b'); await settle();
  check('Exploration unlocks the Scouts’ Lodge build button', await page.locator('[data-build="scoutLodge"]').isEnabled());
  await page.keyboard.press('o'); await settle();
  const site = await page.evaluate(() => __game.renderer.screenPoint({ x: 21.5, y: 31.5 }));
  await page.mouse.click(site.x, site.y); await settle();
  const lodgeId = await page.evaluate(() => __game.state.buildings.find(b => b.kind === 'scoutLodge')?.id);
  check('placing the lodge starts paid construction without producing scouts early', !!lodgeId && (await scoutState()).length === 0
    && await page.evaluate(id => !!__game.state.buildings.find(b => b.id === id)?.construction && __game.state.factions[0].gold === 1900, lodgeId));
  const retinueBefore = await page.evaluate(() => __game.state.units.filter(u => u.kind === 'warrior').map(u => u.id));
  await simulate(58);
  check('a civilian completes the lodge through the normal construction simulation', await page.evaluate(id => {
    const b = __game.state.buildings.find(b => b.id === id); return b?.hp > 0 && !b.construction;
  }, lodgeId));
  check('the completed lodge produces no automatic scouts', (await scoutState()).length === 0);
  check('completing a lodge does not take soldiers from the retinue', await page.evaluate(ids => {
    return JSON.stringify(__game.state.units.filter(u => u.kind === 'warrior' && u.hp > 0).map(u => u.id)) === JSON.stringify(ids);
  }, retinueBefore));
  await page.keyboard.press('Escape');
  await openLodge(lodgeId);
  const text = await page.locator('.activity-scouts').innerText();
  check('lodge popup explains observation posts without a recruitment counter or slider',
    text.includes('Observation posts unlocked') && text.includes('outside all borders')
    && await page.locator('[name="scouts"], .scout-count').count() === 0, text);
  const panel = await popup.boundingBox();
  check('lodge popup occupies less than ten percent of the desktop', panel.width * panel.height < 1440 * 900 * .1, panel);
  await page.screenshot({ path: `${output}/popup-desktop.png` });
  await page.locator('.activity-close').click();
  await simulate(180);
  check('three minutes after completion there are still no automatic scouts', (await scoutState()).length === 0);
  await page.evaluate(async () => {
    const { entityStore } = await import('/src/game/entity-store.ts');
    entityStore(__game.state).buildings.add({ id: 10000, kind: 'scoutLodge', x: 12, y: 34, faction: 0, hp: 250, maxHp: 250, capacity: 0 });
  });
  await simulate(30);
  check('additional lodges also produce no automatic scouts', (await scoutState()).length === 0);
  await page.keyboard.press('f'); await settle();
  check('a completed lodge enables Observation post in Fortify', await page.locator('[data-build="observationPost"]').isEnabled());
  const deployment = await page.evaluate(() => {
    const s = __game.state, leader = s.units.find(u => u.kind === 'leader' && u.faction === 0);
    Object.assign(leader, { x: 45.5, y: 31.5 }); delete leader.path; delete leader.destination;
    __game.renderer.camera = { x: 47, y: 31 }; __game.renderer.follow = false;
    return { gold: s.factions[0].gold, population: s.factions[0].population,
      point: __game.renderer.screenPoint({ x: 47.5, y: 31.5 }) };
  });
  await page.locator('[data-build="observationPost"]').click();
  await settle(); await page.mouse.click(deployment.point.x, deployment.point.y); await settle();
  const deployed = await page.evaluate(() => ({ gold: __game.state.factions[0].gold, population: __game.state.factions[0].population,
    posts: __game.state.units.filter(u => u.hp > 0 && u.observationPost).map(u => ({ x: u.x, y: u.y, attack: u.attack })) }));
  check('manually placing an observation post spends twenty gold and one resident', deployed.posts.length === 1
    && deployed.gold === deployment.gold - 20 && deployed.population === deployment.population - 1, deployed);
  await simulate(31);
  const posted = await scoutState();
  check('the only scout remains stationed at the manually placed post', posted.length === 1 && posted[0].observationPost
    && posted[0].x === 47.5 && posted[0].y === 31.5, posted);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 750, height: 500 }); await settle(); await openLodge(lodgeId);
  const compact = await popup.boundingBox();
  check('compact lodge status stays inside the viewport', compact.x >= 0 && compact.y >= 0 && compact.x + compact.width <= 750 && compact.y + compact.height <= 500, compact);
  await page.screenshot({ path: `${output}/popup-compact.png` });
  check('no runtime errors', errors.length === 0, errors);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); throw error;
} finally {
  writeFileSync(`${output}/popup-check.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
