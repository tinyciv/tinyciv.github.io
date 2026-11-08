import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const folder = 'scratch/2026-11-07-hill-biomes-game';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
// Other workspace tasks may trigger Vite reloads; hold this inspection session
// on one loaded module graph while validating the generated world.
await page.routeWebSocket(/.*/, socket => socket.close());
const errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); };
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5198/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready', null, { timeout: 90000 });
  const report = await page.evaluate(() => {
    const game = window.__game, start = performance.now();
    game.newWorld('SAND-BIRCH-19', 'fractal'); game.state.paused = true; game.replaceState(game.state);
    const { world } = game.state;
    return { seed: world.seed, width: world.width, height: world.height, generationMs: performance.now() - start,
      biomes: ['desert-hills', 'forest-hills'].map(biome => {
        const tiles = world.tiles.filter(tile => tile.hillBiome === biome);
        return { biome, cells: tiles.length, hills: new Set(tiles.filter(t => t.ridge).map(t => t.ridge)).size,
          twoLevels: new Set(tiles.filter(t => t.ridgeTier === 2).map(t => t.ridge)).size, trees: tiles.filter(t => t.overlay === 'forest').length };
      }) };
  });
  check('normal New World generation includes both hill biomes', report.biomes.every(b => b.hills >= 5), report);
  check('occasional two-level hills reach the game', report.biomes.some(b => b.twoLevels > 0), report.biomes);
  check('forest hills have woodland', report.biomes.find(b => b.biome === 'forest-hills').trees > 30, report.biomes);
  for (const biome of ['desert-hills', 'forest-hills']) {
    const detail = await page.evaluate(async biome => {
      const { updateFog } = await import('/src/game/fog.ts');
      const { ridgeGroundWalkable } = await import('/src/game/ridges.ts');
      const { state, renderer } = window.__game, world = state.world, groups = new Map();
      world.tiles.forEach((tile, cell) => {
        if (tile.hillBiome !== biome || !tile.ridge) return;
        const cells = groups.get(tile.ridge) ?? []; cells.push(cell); groups.set(tile.ridge, cells);
      });
      const hills = [...groups.values()].sort((a, b) => {
        const score = cells => cells.length + (cells.some(k => world.tiles[k].ridgeTier === 2) ? 1000 : 0);
        return score(b) - score(a);
      });
      const hill = hills[0], xs = hill.map(k => k % world.width), ys = hill.map(k => Math.floor(k / world.width));
      renderer.follow = false; renderer.zoom = 1;
      renderer.camera = { x: (Math.min(...xs) + Math.max(...xs) + 1) / 2, y: (Math.min(...ys) + Math.max(...ys) + 1) / 2 };
      const fog = updateFog(state); fog.visible.fill(1); fog.explored.fill(1); fog.owned.fill(1); fog.revision++; fog.explorationRevision++;
      // Read-only inspection in an ephemeral browser context, with live game art.
      renderer.gpu.drawFog = () => {};
      const cell = hill.find(k => ridgeGroundWalkable(world, k % world.width, Math.floor(k / world.width))) ?? hill[0];
      renderer.showYields = true; renderer.hover = { x: cell % world.width + .5, y: Math.floor(cell / world.width) + .5 };
      const screen = renderer.screenPoint(renderer.hover), rect = renderer.canvas.getBoundingClientRect();
      renderer.draw(state, 0);
      return { biome, ridge: world.tiles[cell].ridge, area: hill.length, tiers: [...new Set(hill.map(k => world.tiles[k].ridgeTier))],
        ramps: hill.filter(k => world.tiles[k].stair).length, camera: renderer.camera, screen: { x: screen.x + rect.left, y: screen.y + rect.top } };
    }, biome);
    const label = biome === 'desert-hills' ? 'Desert hills' : 'Forest hills';
    await page.mouse.move(detail.screen.x, detail.screen.y);
    await page.waitForFunction(label => document.querySelector('#tile-tooltip')?.textContent.includes(label), label, { timeout: 15000 });
    check(`${biome}: terrain inspector identifies the new biome`, await page.locator('#tile-tooltip').isVisible(), detail);
    await page.screenshot({ path: `${folder}/${biome}-ingame.png`, fullPage: true });
  }
  check('no browser errors', errors.length === 0, errors);
  await writeFile(`${folder}/browser-checks.json`, JSON.stringify({ report, checks, errors }, null, 2));
  console.log(JSON.stringify({ report, passed: checks.length, errors }, null, 2));
} finally { await browser.close(); }
