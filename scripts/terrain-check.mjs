import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// An ephemeral browser profile is intentional: this fixture must never replace
// a player's local save. Every map modification below lives in this context.
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
mkdirSync('output', { recursive: true });
const report = { seed: 'BTV-847', samples: [], incrementalUpdates: [] };

async function capture(path) {
  await page.mouse.move(1400, 20);
  await page.waitForTimeout(180);
  await page.screenshot({ path });
}

async function benchmark(label) {
  const result = await page.evaluate(async () => {
    const { paintTerrain } = await import('/src/game/terrain.ts');
    const { state, renderer } = window.__game;
    const before = JSON.stringify(state.world);
    const times = [];
    for (let i = 0; i < 8; i++) renderer.draw(state, 0);
    for (let i = 0; i < 45; i++) {
      const start = performance.now();
      renderer.draw(state, 0);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const start = performance.now();
    renderer.prepare(state);
    const cachedPreparationMs = performance.now() - start;
    const freshGround = document.createElement('canvas');
    const fullStart = performance.now();
    paintTerrain(freshGround, state.world);
    const fullGroundPaintMs = performance.now() - fullStart;
    freshGround.width = freshGround.height = 0;
    return {
      zoom: renderer.zoom,
      camera: renderer.camera,
      medianDrawMs: times[Math.floor(times.length / 2)],
      p95DrawMs: times[Math.floor(times.length * .95)],
      cachedPreparationMs,
      fullGroundPaintMs,
      unchangedWorld: before === JSON.stringify(state.world),
    };
  });
  assert.equal(result.unchangedWorld, true, 'Rendering must not rewrite existing map data');
  report.samples.push({ label, ...result });
  console.log(`${label}: cached draw median ${result.medianDrawMs.toFixed(1)} ms, p95 ${result.p95DrawMs.toFixed(1)} ms; cached prepare ${result.cachedPreparationMs.toFixed(1)} ms; full ground paint ${result.fullGroundPaintMs.toFixed(1)} ms`);
}

async function verifyFarmUpdate(label, point) {
  const result = await page.evaluate(async point => {
    const { paintTerrain } = await import('/src/game/terrain.ts');
    const { isVisible } = await import('/src/game/fog.ts');
    const { state, renderer } = window.__game;
    const { world } = state;
    if (!point) {
      const candidates = world.tiles.map((tile, i) => ({ tile, x: i % world.width, y: Math.floor(i / world.width) }))
        .filter(({ tile, x, y }) => ['forest', 'jungle'].includes(tile.overlay) && tile.farm === undefined && isVisible(state, x + .5, y + .5))
        .sort((a, b) => Math.hypot(a.x - renderer.camera.x, a.y - renderer.camera.y) - Math.hypot(b.x - renderer.camera.x, b.y - renderer.camera.y));
      point = { x: candidates[0].x, y: candidates[0].y };
    }
    const before = renderer.canvas.toDataURL();
    const tile = world.tiles[point.y * world.width + point.x];
    tile.overlay = 'none';
    tile.farm = 0;
    world.revision = (world.revision ?? 0) + 1;
    const updateStart = performance.now();
    renderer.draw(state, 0);
    const revisionDrawMs = performance.now() - updateStart;
    const visibleChange = before !== renderer.canvas.toDataURL();
    // TypeScript private fields remain inspectable in this development-only
    // harness. Compare every ground pixel, including the region outside the edit.
    const cached = renderer.terrain;
    const full = document.createElement('canvas');
    const fullStart = performance.now();
    paintTerrain(full, world);
    const fullGroundPaintMs = performance.now() - fullStart;
    const a = cached.getContext('2d').getImageData(0, 0, cached.width, cached.height).data;
    const b = full.getContext('2d').getImageData(0, 0, full.width, full.height).data;
    let mismatchedPixels = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) mismatchedPixels++;
    }
    full.width = full.height = 0;
    return { point, worldSize: { width: world.width, height: world.height }, revisionDrawMs, fullGroundPaintMs, visibleChange, mismatchedPixels };
  }, point);
  assert.equal(result.visibleChange, true, 'Clearing a new farm must invalidate cached terrain');
  assert.equal(result.mismatchedPixels, 0, 'Incremental ground must exactly match a fresh full paint');
  report.incrementalUpdates.push({ label, ...result });
  console.log(`${label}: farm revision + draw ${result.revisionDrawMs.toFixed(1)} ms vs full ground paint ${result.fullGroundPaintMs.toFixed(1)} ms; ${result.mismatchedPixels} mismatched pixels`);
}

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game, undefined, { timeout: 20000 });
  const generatedOverlays = await page.evaluate(() => {
    window.__game.newWorld('BTV-847');
    window.__game.state.paused = true;
    return [...new Set(window.__game.state.world.tiles.map(tile => tile.overlay))].sort();
  });
  assert.deepEqual(generatedOverlays, ['ford', 'forest', 'none'], 'Generated worlds must contain only supported overlays');
  report.generatedOverlays = generatedOverlays;
  // Generated geography at three supported zoom levels, with its real units,
  // buildings, rivers, and biome boundaries left intact.
  const camera = await page.evaluate(() => {
    const { state, renderer } = window.__game;
    const { world } = state;
    const leader = state.units.find(u => u.faction === 0 && u.kind === 'leader');
    let best = { x: leader.x, y: leader.y }, bestScore = -Infinity;
    for (let cy = 13; cy < world.height - 13; cy += 3) for (let cx = 17; cx < world.width - 17; cx += 3) {
      const kinds = new Set();
      let rivers = 0, forests = 0, ocean = 0;
      for (let dy = -9; dy <= 8; dy++) for (let dx = -13; dx <= 13; dx++) {
        const tile = world.tiles[(cy + dy) * world.width + cx + dx];
        kinds.add(tile.terrain);
        rivers += tile.terrain === 'river' ? 1 : 0;
        forests += ['forest', 'jungle'].includes(tile.overlay) ? 1 : 0;
        ocean += ['ocean', 'coast'].includes(tile.terrain) ? 1 : 0;
      }
      const score = Math.min(rivers, 30) * 2
        + Math.min(forests, 60) * .4 + kinds.size * 6 - ocean * .8
        - Math.hypot(cx - leader.x, cy - leader.y) * 1.5;
      if (score > bestScore) { bestScore = score; best = { x: cx, y: cy }; }
    }
    renderer.follow = false;
    renderer.camera = best;
    return best;
  });
  report.generatedCamera = camera;
  for (const zoom of [.65, 1.35, 2.2]) {
    await page.evaluate(zoom => {
      const { state, renderer } = window.__game;
      renderer.zoom = zoom;
      renderer.draw(state, 0);
    }, zoom);
    const label = `generated-${String(zoom).replace('.', '-')}`;
    await capture(`output/btv-terrain-${label}.png`);
    await benchmark(label);
  }
  await verifyFarmUpdate('generated-farm');

  await page.evaluate(async () => {
    const { terrainYields } = await import('/src/world/generator.ts');
    const { state, renderer } = window.__game;
    const width = 64, height = 64;
    const variation = (x, y) => ((Math.imul(x + 13, 73856093) ^ Math.imul(y + 29, 19349663)) >>> 0) / 4294967296;
    const tiles = Array.from({ length: width * height }, (_, i) => {
      const x = i % width, y = Math.floor(i / width);
      const desert = x > 30 && y < 22 + Math.sin(x * .49) * 1.5;
      const plain = x > 42 + Math.sin(y * .63) && y > 29;
      const terrain = x < 5 || x > 59 || y < 5 || y > 59 ? 'ocean' : desert ? 'desert' : plain ? 'plains' : 'grassland';
      let overlay = 'none';
      if (terrain === 'grassland' && x > 29 && y > 23 && variation(x, y) > .2) overlay = 'forest';
      return { terrain, overlay, elevation: .4, moisture: .6, variation: variation(x, y), ...terrainYields(terrain, overlay) };
    });
    const tile = (x, y) => tiles[y * width + x];
    const set = (x, y, changes) => { Object.assign(tile(x, y), changes); Object.assign(tile(x, y), terrainYields(tile(x, y).terrain, tile(x, y).overlay)); };
    const riverX = y => y < 18 ? 25 : y < 23 ? 24 : y < 27 ? 25 : y < 31 ? 26 : y < 34 ? 25 : 27;
    for (let y = 5; y < 60; y++) {
      const x = riverX(y), previous = riverX(Math.max(5, y - 1));
      for (let rx = Math.min(x, previous); rx <= Math.max(x, previous); rx++) set(rx, y, { terrain: 'river', overlay: 'none' });
    }
    for (const [x, y] of [[36, 29], [37, 29], [33, 32], [39, 33]]) set(x, y, { terrain: 'grassland', overlay: 'none', farm: 0 });
    const buildings = [];
    let nextId = 1000;
    const building = (kind, x, y) => {
      buildings.push({ id: nextId++, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: kind === 'cottage' ? 8 : kind === 'camp' ? 3 : 0, connected: true });
      if (kind !== 'bridge') set(x, y, { overlay: 'none' });
    };
    for (let x = 22; x <= 32; x++) building(x === 25 ? 'bridge' : 'road', x, 26);
    for (let y = 27; y <= 29; y++) building('road', 32, y);
    building('cottage', 39, 29);
    building('cottage', 40, 33);
    building('camp', 35, 26);
    building('camp', 41, 27);
    for (let x = 38; x <= 40; x++) building('wall', x, 35);
    state.world = { width, height, seed: 'BTV-terrain-showcase', tiles, spawns: [{ x: 32.5, y: 26.5 }], source: 'Deterministic visual QA fixture', revision: 1 };
    state.seed = state.world.seed;
    state.time = 7;
    state.paused = true;
    window.__game.entities(state).buildings.replace(buildings);
    const originalLeader = state.units.find(u => u.kind === 'leader' && u.faction === 0);
    const originalWarrior = state.units.find(u => u.kind === 'warrior' && u.faction === 0);
    const originalWorker = state.units.find(u => u.kind === 'worker' && u.faction === 0);
    const unit = (template, x, y, hp = 100, faction = 0) => ({ ...template, id: nextId++, x, y, hp, faction, destination: undefined, path: undefined, target: undefined, work: undefined, moving: false, facing: 0 });
    const leader = unit(originalLeader, 21.55, 24.85, 78);
    window.__game.entities(state).units.replace([leader, unit(originalWarrior, 30.5, 24.8, 66), unit(originalWarrior, 34.5, 28.2), unit(originalWarrior, 42.5, 32.5, 100, 3), unit(originalWorker, 36.5, 29.5), unit(originalWorker, 37.5, 29.5), unit(originalWorker, 33.5, 32.5), unit(originalWorker, 39.5, 33.5)]);
    // Deliberate vegetation overlap makes canopy depth and unit readability visible.
    set(30, 25, { overlay: 'forest' });
    set(34, 28, { overlay: 'forest' });
    state.selected = leader.id;
    state.selectedType = 'unit';
    state.buildMode = null;
    state.particles = [];
    state.gameOver = false;
    renderer.follow = false;
    renderer.camera = { x: 32, y: 27 };
    renderer.zoom = 1.35;
    renderer.hover = null;
    renderer.prepare(state);
    renderer.draw(state, 0);
  });
  await capture('output/btv-terrain-showcase.png');
  await benchmark('showcase');

  await verifyFarmUpdate('showcase-farm', { x: 34, y: 28 });
  assert.deepEqual(errors, []);
  report.revisionInvalidation = true;
  report.runtimeErrors = errors;
  writeFileSync('output/btv-terrain-report.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log('PASS deterministic terrain showcase, real-map zooms, revision invalidation, and no browser errors');
} finally {
  await context.close();
  await browser.close();
}
