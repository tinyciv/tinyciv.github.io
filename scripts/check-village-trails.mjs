import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
const output = 'scratch/2026-11-03-world-additions'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error))); await page.routeWebSocket('**', socket => socket.close());
const check = (name, pass, details) => { checks.push({ name, pass: !!pass, details }); console.log(name, !!pass, JSON.stringify(details)); assert.ok(pass, name); };
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  const initial = await page.evaluate(async () => {
    const { initializeVillageTrails } = await import('/src/game/village-trails.ts');
    const fogUrl = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/game/fog.ts')?.name || '/src/game/fog.ts';
    const { updateFog } = await import(fogUrl);
    const { movementMultiplier, hasStaticPath } = await import('/src/game/pathfinding.ts');
    const width = 44, height = 40;
    const world = { width, height, seed: 'village-trails-review', source: 'Isolated village-trail review fixture', spawns: [], revision: 1,
      tiles: Array.from({ length: width * height }, (_, cell) => ({ terrain: cell % width >= 19 && cell % width <= 21 ? 'river' : 'grassland',
        overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .5 })) };
    const faction = (id, name, color) => ({ id, name, color, affinity: 100, relation: id ? 'peace' : 'self', population: id ? 3 : 20,
      food: 1000, gold: 5000, production: 0, culture: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false });
    const unit = (id, kind, faction, x, y, extras = {}) => ({ id, kind, faction, x, y, hp: 100, maxHp: 100, morale: 100,
      attack: 0, defense: 4, speed: kind === 'leader' ? 3.6 : 2.4, range: 1, order: 'hold', cooldown: 0, lastCombat: -60,
      lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0, ...extras });
    const villages = [8, 32].map((x, index) => ({ id: index + 1, faction: index + 1, campId: 100 + index * 10,
      name: index ? 'Veneti Crossing' : 'Sabine Grove', identity: index ? 'merchants' : 'growers', relation: 'neutral',
      x, y: 20, nextGrowthAt: 1e9, nextThinkAt: 1e9, nextRecruitAt: 1e9 }));
    const buildings = [{ id: 1, kind: 'palace', faction: 0, x: 13, y: 32, hp: 650, maxHp: 650, capacity: 20,
      unhousedResidents: 20, cityName: 'Roma', governorPermissions: { farms: false, housing: false } }];
    const units = [unit(10, 'leader', 0, 16.5, 22.5)];
    for (const village of villages) {
      for (const [i, [dx, dy]] of [[-2, -1], [2, -1], [0, 2]].entries()) {
        buildings.push({ id: village.campId + i, kind: 'villageTent', faction: village.faction, villageId: village.id,
          x: village.x + dx, y: village.y + dy, hp: 500, maxHp: 500, capacity: 0 });
        units.push(unit(200 + village.id * 10 + i, 'worker', village.faction, village.x + dx + .7, village.y + dy + 1.3,
          { villageId: village.id, home: village.campId }));
      }
    }
    const s = { world, buildings, units, villages, factions: [faction(0, 'Romans', '#c94c4c'), faction(1, 'Sabine', '#ffffff'), faction(2, 'Veneti', '#ffffff')],
      time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], fields: [], projectiles: [], bloodEffects: [], treasures: [],
      raiderCamps: [], marauderPacks: [], treeClearings: [], roamingMaraudersVersion: 1,
      wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, banditIntensity: 0,
      fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 }, selected: 10, selectedType: 'unit', buildMode: null, diplomacy: null,
      gameOver: false, victory: false, victoryContinued: true, seed: world.seed, rngState: 1, retinueStance: 'hold', movementMode: 'travel', traffic: {} };
    const report = initializeVillageTrails(s); __game.replaceState(s); const fog = updateFog(s);
    const unknownTrail = world.tiles.findIndex((tile, cell) => tile.villageTrail && !fog.explored[cell]);
    window.__trailReveal = () => {
      const fog = updateFog(s); fog.explored.fill(1); fog.visible.fill(1); fog.revision++; fog.explorationRevision++;
      fog.memorySignature = ''; updateFog(s);
    };
    __trailReveal(); __game.renderer.prepare(s); __game.renderer.follow = false; __game.renderer.camera = { x: 20.5, y: 20.5 }; __game.renderer.zoom = 1.25;
    for (let frame = 0; frame < 18; frame++) __game.renderer.draw(s, .05);
    const ford = world.tiles.map((tile, cell) => tile.terrain === 'river' && tile.overlay === 'ford' ? { x: cell % width, y: Math.floor(cell / width), axis: tile.fordAxis } : null).filter(Boolean);
    return { report, ford, unknownTrail, roadBuildings: buildings.filter(b => b.kind === 'road').length,
      trailSpeed: movementMultiplier(s, 16.5, 20.5), bareSpeed: movementMultiplier(s, 16.5, 17.5),
      fordSpeed: movementMultiplier(s, 20.5, 20.5), connected: hasStaticPath(s, { x: 8.5, y: 20.5 }, { x: 32.5, y: 20.5 }, 0) };
  });
  check('two village clusters joined by generated terrain trails, not road buildings', initial.report.connectedVillages === 2 && initial.roadBuildings === 0 && initial.connected, initial);
  check('river uses one complete three-tile native ford', initial.ford.length === 3 && initial.ford.every(tile => tile.y === initial.ford[0].y && tile.axis === 'horizontal'), initial.ford);
  check('trail travel adds exactly5% and unknown trails remain unexplored before fixture reveal', Math.abs(initial.trailSpeed / initial.bareSpeed - 1.05) < 1e-10 && initial.unknownTrail >= 0, { speed: initial.trailSpeed, bare: initial.bareSpeed, unknownTrail: initial.unknownTrail });
  await page.waitForTimeout(120);
  await page.locator('[data-action="build"]').click();
  check('build menu has no dirt-trail action', await page.locator('[data-build="trail"]').count() === 0 && !(await page.locator('#build-panel').innerText()).includes('Dirt trail'), await page.locator('#build-panel').innerText());
  await page.locator('[data-action="build"]').click();
  await page.screenshot({ path: `${output}/village-trails.png` });

  const replacement = await page.evaluate(async () => {
    const entityStore = __game.entities;
    const { markWorldChanged } = await import('/src/game/world-revisions.ts');
    const { movementMultiplier, invalidateNavigation } = await import('/src/game/pathfinding.ts');
    const s = __game.state, point = { x: 16, y: 20 }, cell = point.y * s.world.width + point.x;
    entityStore(s).buildings.add({ id: 500, kind: 'road', faction: 0, x: 16, y: 21, hp: 100, maxHp: 100, capacity: 0 });
    markWorldChanged(s.world, 'structure');
    const before = !!s.world.tiles[cell].villageTrail, result = __game.build('road', point.x, point.y);
    const road = s.buildings.find(b => b.kind === 'road' && b.x === point.x && b.y === point.y);
    if (road) { delete road.construction; entityStore(s).buildings.updateRoles(road); invalidateNavigation(s); markWorldChanged(s.world); }
    __trailReveal(); for (let frame = 0; frame < 18; frame++) __game.renderer.draw(s, .05);
    return { before, result, trailFlag: !!s.world.tiles[cell].villageTrail, normalRoad: !!road && !road.roadStyle,
      movement: movementMultiplier(s, point.x + .5, point.y + .5), rememberedRoads: s.fog?.buildings?.filter(b => b.kind === 'road').map(b => ({id:b.id,x:b.x,y:b.y,construction:b.construction})), roads: s.buildings.filter(b => b.kind === 'road').map(b=>({id:b.id,x:b.x,y:b.y,construction:b.construction})) };
  });
  check('legal road order removes the trail flag and uses normal road art/speed', replacement.before && replacement.result.ok && !replacement.trailFlag && replacement.normalRoad && replacement.movement === 1.5, replacement);
  await page.waitForTimeout(120); await page.screenshot({ path: `${output}/village-trail-road-replacement.png` });
  await page.screenshot({ path: `${output}/village-trail-road-closeup.png`, clip: {x:480,y:390,width:240,height:200} });
  check('no browser runtime errors', errors.length === 0, errors);
  rmSync(`${output}/village-trails-failure.png`, { force: true });
} catch (error) {
  await page.screenshot({ path: `${output}/village-trails-failure.png` }).catch(() => {}); throw error;
} finally {
  writeFileSync(`${output}/village-trails-checks.json`, JSON.stringify({ checks, errors }, null, 2)); await browser.close();
}
