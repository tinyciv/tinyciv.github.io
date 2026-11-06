import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const output = 'scratch/2026-11-03-river-trade'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
page.on('pageerror', error => errors.push(String(error))); await page.routeWebSocket('**', socket => socket.close());
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  const initial = await page.evaluate(async () => {
    const { updateTradeRoutes, updateMerchant } = await import('/src/game/trade.ts');
    const { moveUnit } = await import('/src/game/simulation.ts');
    const fogUrl = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/game/fog.ts')?.name || '/src/game/fog.ts';
    const { updateFog } = await import(fogUrl);
    const { riverTradingPosts } = await import('/src/game/river-trade.ts');
    const width = 80, height = 38;
    const world = { width, height, seed: 'river-trade-review', source: 'Isolated river trade review', revision: 0, spawns: [],
      tiles: Array.from({ length: width * height }, (_, i) => ({ terrain: Math.floor(i / width) >= 18 && Math.floor(i / width) <= 20 ? 'river' : 'grassland',
        overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) };
    const city = (id, x) => ({ id, kind: 'palace', faction: 0, x, y: 12, hp: 650, maxHp: 650, capacity: 100,
      unhousedResidents: 100, cityName: id === 1 ? 'Roma' : 'Capua', governorPermissions: { farms: false, housing: false } });
    const state = { world, buildings: [city(1, 8), city(2, 60)], units: [], fields: [],
      factions: [{ id: 0, name: 'Romans', color: '#c94c4c', relation: 'self', affinity: 100, population: 200, food: 1000,
        gold: 0, culture: 0, production: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false,
        research: { priorities: ['sailing'], allocations: {}, disabled: [], levels: { sailing: 1 }, progress: {} } }],
      time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], projectiles: [], bloodEffects: [], treasures: [],
      villages: [], raiderCamps: [], marauderPacks: [], treeClearings: [], selected: null, selectedType: null, buildMode: null,
      diplomacy: null, gameOver: false, victory: false, seed: world.seed, rngState: 1, roamingMaraudersVersion: 1,
      fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 }, wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, banditIntensity: 0 };
    __game.replaceState(state); updateTradeRoutes(state);
    window.__riverAdvance = (until, frames = 3000) => {
      const route = state.tradeRoutes[0], merchant = state.units.find(u => u.id === route.merchantId), phases = [], positions = [];
      for (let frame = 0; frame < frames; frame++) {
        if (until === 'middle' ? route.riverLeg?.phase === 'river' && merchant.x >= 33 : until === 'arrival' ? route.journeys > 0 : route.riverLeg?.phase === until) break;
        state.time += .05; const from = { x: merchant.x, y: merchant.y };
        updateMerchant(state, merchant, .05, moveUnit); phases.push(route.riverLeg?.phase);
        positions.push({ x: merchant.x, y: merchant.y, step: Math.hypot(merchant.x - from.x, merchant.y - from.y) });
      }
      return { route: structuredClone(route), merchant: structuredClone(merchant), phases: [...new Set(phases)], maxStep: Math.max(0, ...positions.map(p => p.step)), gold: state.factions[0].gold };
    };
    window.__riverReveal = () => { const fog = updateFog(state); fog.explored.fill(1); fog.visible.fill(1);
      fog.revision++; fog.explorationRevision++; fog.memorySignature = ''; updateFog(state);
      __game.renderer.prepare(state); for (let i = 0; i < 18; i++) __game.renderer.draw(state, .05); };
    __game.renderer.follow = false; __game.renderer.camera = { x: 35, y: 17 }; __game.renderer.zoom = .7;
    __riverReveal(); return { routes: state.tradeRoutes.length, merchants: state.units.length, posts: riverTradingPosts(state), river: state.tradeRoutes[0]?.river };
  });
  assert.equal(initial.routes, 1); assert.equal(initial.merchants, 1); assert.equal(initial.posts.length, 2); assert.ok(initial.river);
  const boarding = await page.evaluate(() => { const result = __riverAdvance('board');
    __game.renderer.camera = { x: result.route.river.origin.shore.x, y: 15.5 }; __game.renderer.zoom = 1.7; __riverReveal(); return result; });
  await page.screenshot({ path: `${output}/boarding-post.png` });
  const sailing = await page.evaluate(() => { const result = __riverAdvance('middle');
    __game.renderer.camera = { x: 35, y: 17 }; __game.renderer.zoom = .7; __riverReveal(); return result; });
  assert.equal(sailing.merchant.aboardRiverTrade, true); assert.ok(sailing.maxStep <= .065001);
  await page.screenshot({ path: `${output}/river-trade-overview.png` });
  const landing = await page.evaluate(() => { const result = __riverAdvance('disembark');
    __game.renderer.camera = { x: result.route.river.partner.shore.x, y: 15.5 }; __game.renderer.zoom = 1.7; __riverReveal(); return result; });
  await page.screenshot({ path: `${output}/landing-post.png` });
  const arrival = await page.evaluate(() => { const result = __riverAdvance('arrival'); __riverReveal(); return result; });
  assert.equal(arrival.route.journeys, 1); assert.equal(arrival.merchant.aboardRiverTrade, false);
  assert.ok(Math.abs(arrival.gold - sailing.route.legValue.gold) < 1e-8); assert.deepEqual(errors, []);
  writeFileSync(`${output}/results.json`, JSON.stringify({ initial, boarding, sailing, landing, arrival, errors }, null, 2));
  console.log(JSON.stringify({ pass: true, posts: initial.posts, quote: sailing.route.legValue, paid: arrival.gold, errors }));
} catch (error) { await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); throw error; }
finally { await browser.close(); }
