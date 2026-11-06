import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const output = 'scratch/2026-11-03-ballista'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const checks = [], errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.routeWebSocket('**', socket => socket.close());
const check = (label, value, data) => { checks.push({ label, pass: !!value, data }); console.log(label, !!value); assert.ok(value, `${label}: ${JSON.stringify(data)}`); };
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  await page.evaluate(async () => {
    const person = (id, kind, x, y, faction = 0) => ({ id, kind, x, y, faction, hp: 1000, maxHp: 1000, morale: 100,
      attack: 0, defense: 0, speed: 0, range: 1.1, order: 'hold', retinueStance: 'hold', cooldown: 0, lastCombat: -60,
      lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0 });
    const building = (id, kind, x, y, faction = 0) => ({ id, kind, x, y, faction, hp: 1000, maxHp: 1000, capacity: 0,
      populationGrowth: -10000, governorPermissions: { farms: false, housing: false } });
    const faction = id => ({ id, name: id ? 'Rival' : 'Roma', color: id ? '#5577cc' : '#c94c4c', relation: id ? 'war' : 'self',
      affinity: id ? 0 : 100, food: 0, gold: 2000, production: 0, population: 0, culture: 0, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false });
    const world = { width: 64, height: 64, seed: 'ballista-browser', source: 'isolated QA', spawns: [], revision: 1,
      tiles: Array.from({ length: 4096 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .7,
        food: 3, production: 1, gold: 0, variation: i % 13 / 13 })) };
    const s = { world, buildings: [building(1, 'palace', 2, 2), building(2, 'ballista', 32, 32)],
      units: [person(10, 'leader', 3.5, 5.5), person(20, 'warrior', 32.5, 14.5, 1)], factions: [faction(0), faction(1)],
      time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], fields: [], projectiles: [], bloodEffects: [], treasures: [],
      raiderCamps: [], marauderPacks: [], villages: [], treeClearings: [], roamingMaraudersVersion: 1,
      wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, banditIntensity: 0,
      fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 }, selected: 2, selectedType: 'building', buildMode: null, diplomacy: null,
      gameOver: false, victory: false, victoryContinued: true, seed: world.seed, rngState: 1, retinueStance: 'hold', movementMode: 'travel', traffic: {} };
    __game.replaceState(s); const { updateFog } = await import('/src/game/fog.ts'); updateFog(s);
    __game.renderer.prepare(s); __game.renderer.follow = false; __game.renderer.camera = { x: 32.5, y: 32.5 }; __game.renderer.zoom = 3;
  });
  const keys = [];
  for (const [name, dx, dy, row] of [['north', 0, -18, 0], ['east', 18, 0, 2], ['south', 0, 18, 1], ['west', -18, 0, 3]]) {
    const result = await page.evaluate(async ({ dx, dy }) => {
      const s = __game.state, engine = s.buildings.find(b => b.id === 2), target = s.units.find(u => u.id === 20);
      target.x = 32.5 + dx; target.y = 32.5 + dy; target.hp = 1000; engine.attackCooldown = 0; s.projectiles = [];
      __game.replaceState(s); s.paused = false;
      for (let frame = 0; frame < 18; frame++) { __game.step(.05); __game.renderer.draw(s, .05); }
      s.paused = true;
      const { ballistaFrame } = await import('/src/game/siege-art.ts'), { buildingKey } = await import('/src/game/native-art.ts');
      return { shot: s.projectiles[0], facing: engine.siegeFacing, frame: ballistaFrame(engine, s.time), key: buildingKey(engine, s.time, '#c94c4c') };
    }, { dx, dy });
    check(`${name}: autonomous shot reaches 18 tiles and aims toward its target`, result.shot?.target === 20
      && Math.abs(Math.hypot(result.shot.end.x - result.shot.start.x, result.shot.end.y - result.shot.start.y) - 18) < 1e-7
      && Math.abs(result.facing - Math.atan2(dy, dx)) < 1e-7 && result.frame.row === row, result);
    keys.push(result.key); await page.waitForTimeout(160); await page.screenshot({ path: `${output}/shot-${name}.png` });
  }
  check('turning the same ballista selects four distinct native cached sprites', new Set(keys).size === 4, keys);
  const hit = await page.evaluate(() => {
    const s = __game.state, target = s.units.find(u => u.id === 20); s.paused = false;
    for (let i = 0; i < 32; i++) { __game.step(.05); __game.renderer.draw(s, .05); }
    s.paused = true; return { hp: target.hp, projectiles: s.projectiles.length };
  });
  check('bolt actually damages the target at the full 18-tile range', hit.hp < 1000 && hit.projectiles === 0, hit);
  const outside = await page.evaluate(() => {
    const s = __game.state, engine = s.buildings.find(b => b.id === 2), target = s.units.find(u => u.id === 20);
    target.x = 50.501; target.y = 32.5; engine.attackCooldown = 0; s.projectiles = []; __game.replaceState(s);
    s.paused = false; __game.step(.05); s.paused = true; return s.projectiles.length;
  }); check('targets just beyond 18 tiles remain out of range', outside === 0, outside);
  const npc = await page.evaluate(() => {
    const s = __game.state, engine = s.buildings.find(b => b.id === 2), target = s.units.find(u => u.id === 20);
    engine.faction = 1; target.faction = 0; target.x = 50.5; target.y = 32.5; engine.attackCooldown = 0; s.projectiles = [];
    __game.replaceState(s); s.paused = false; __game.step(.05); s.paused = true; return s.projectiles.map(p => ({ target: p.target, faction: p.faction }));
  }); check('enemy ballista also sees and fires at the full 18-tile range', npc.length === 1 && npc[0].target === 20 && npc[0].faction === 1, npc);
  const native = await page.evaluate(async () => {
    const { drawBallista } = await import('/src/game/siege-art.ts');
    const overlay = document.createElement('div'); overlay.id = 'ballista-native-review';
    overlay.style.cssText = 'position:fixed;inset:90px 140px auto;z-index:10000;background:#1b2a25;border:2px solid #a58a55;border-radius:12px;padding:24px;color:#f3dfaa;font-family:"Pixel Operator";display:flex;gap:28px;justify-content:center';
    for (const [label, facing] of [['North', -Math.PI / 2], ['East', 0], ['South', Math.PI / 2], ['West', Math.PI]]) {
      const group = document.createElement('div'), title = document.createElement('p'), canvas = document.createElement('canvas');
      title.textContent = label; title.style.cssText = 'text-align:center;font-size:24px;margin:0 0 14px'; canvas.width = canvas.height = 160;
      const c = canvas.getContext('2d'); drawBallista(c, { siegeFacing: facing }, 0, 0, 160, 0); group.append(title, canvas); overlay.append(group);
    }
    document.body.append(overlay); return overlay.children.length;
  }); check('all four unmodified native aim directions render for visual inspection', native === 4);
  await page.screenshot({ path: `${output}/native-aim-directions.png` });
  check('no runtime errors', errors.length === 0, errors);
} catch (error) { await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); throw error; }
finally { writeFileSync(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2)); await browser.close(); }
