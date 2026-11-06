import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const folder = 'scratch/2026-11-06-faction-forts';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready', null, { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const [{ Renderer }, { createGame }, { generateWorld }, { factionCityTowers }, { constructionEdges }, { hasStaticPath, canWalk }] = await Promise.all([
      import('/src/game/renderer.ts'), import('/src/game/simulation.ts'), import('/src/world/generator.ts'),
      import('/src/game/faction-tower-layout.ts'), import('/src/game/builders.ts'), import('/src/game/pathfinding.ts'),
    ]);
    const flat = { width: 84, height: 64, seed: 'fortified-ai', source: 'test', revision: 0,
      spawns: [{ x: 12, y: 30 }, { x: 64, y: 44 }], secondarySpawns: [{ x: 64, y: 14 }],
      tiles: Array.from({ length: 84 * 64 }, (_, i) => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: (i * 29 % 997) / 997 })) };
    const canvas = document.createElement('canvas'), minimap = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:1100px;height:800px;z-index:999999';
    minimap.width = minimap.height = 160; document.body.append(canvas);
    const renderer = new Renderer(canvas, minimap); await renderer.initialize(); renderer.follow = false;
    let state;
    const prepare = renderer.prepareFog.bind(renderer);
    renderer.prepareFog = fog => {
      fog.visible.fill(1); fog.explored.fill(1); fog.buildings = state.buildings; fog.fields = state.fields ?? []; prepare(fog);
    };
    renderer.gpu.drawFog = () => {};
    const pictures = {}, checks = [];
    for (const [name, world] of [['flat', flat], ['generated', generateWorld('faction-forts-2026')]]) {
      state = createGame(world, undefined, { banditIntensity: 0 }); state.paused = true; state.selected = null;
      const cities = state.buildings.filter(building => building.kind === 'palace' && building.faction > 0 && !building.villageId);
      for (const city of cities) {
        const towers = factionCityTowers(state, city), walls = state.buildings.filter(building => building.faction === city.faction && building.kind === 'palisade');
        checks.push({ world: name, city: city.cityName, faction: city.faction, towers: towers.length,
          enclosures: towers.map(tower => {
            const ring = walls.filter(wall => Math.max(Math.abs(wall.x - tower.x), Math.abs(wall.y - tower.y)) === 1);
            const contacts = constructionEdges(state, tower);
            return { tower: { x: tower.x, y: tower.y }, walls: ring.length, contacts: contacts.length,
              friendlyAccess: contacts.length === 1 && constructionEdges(state, city).some(exit => hasStaticPath(state, exit, contacts[0], city.faction)),
              enemyBlocked: contacts.length === 1 && !canWalk(state, contacts[0].x, contacts[0].y, -2),
              sharedWalls: ring.some(wall => towers.some(other => other !== tower && Math.max(Math.abs(wall.x - other.x), Math.abs(wall.y - other.y)) === 1)) };
          }) });
      }
      const city = cities.find(city => factionCityTowers(state, city).length === 4) ?? cities[0];
      renderer.camera = { x: city.x + 1, y: city.y + 1 }; renderer.zoom = 1.55; renderer.draw(state, 0);
      pictures[name] = renderer.snapshot().toDataURL();
    }
    renderer.destroy(); return { pictures, checks };
  });
  for (const [name, data] of Object.entries(result.pictures)) await writeFile(`${folder}/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
  assert.ok(result.checks.length >= 3);
  assert.ok(result.checks.every(city => city.towers > 0 && city.enclosures.every(fort => fort.walls === 8 && fort.contacts === 1 && fort.friendlyAccess && fort.enemyBlocked && !fort.sharedWalls)));
  assert.deepEqual(errors, []);
  await writeFile(`${folder}/checks.json`, JSON.stringify({ checks: result.checks, errors }, null, 2));
  console.log(JSON.stringify(result.checks, null, 2));
} finally { await browser.close(); }
