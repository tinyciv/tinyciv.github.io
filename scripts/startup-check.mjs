import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer as createPortListener } from 'node:net';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { captureArmsPreview } from './startup-arms-preview.mjs';
import { captureOffensivePreview } from './startup-offensive-preview.mjs';
import { captureBuildingPreview } from './startup-building-preview.mjs';
import { captureCannonFirePreview } from './startup-cannon-fire-preview.mjs';
import { captureShellImpactPreview } from './startup-shell-impact-preview.mjs';
import { captureMeadowPreview } from './startup-meadow-preview.mjs';
import { captureFeedbackPreview } from './startup-feedback-preview.mjs';
import { captureCivicArtGallery } from './startup-civic-art-gallery.mjs';
import { captureCivicPreview } from './startup-civic-preview.mjs';
import { captureAnalyticsPreview } from './startup-analytics-preview.mjs';

// Use unbundled browser modules to catch initialization cycles hidden by builds.
// Reuse each entry point's initial world; no rebuild or gameplay scenario.
// --world checks the menu-free viewer without advancing or interacting with it.
const worldViewer = process.argv.includes('--world');
const captureLedges = process.argv.includes('--capture-ledges');
const captureQuarry = process.argv.includes('--capture-quarry');
const captureMarble = process.argv.includes('--capture-marble');
const captureHarvest = process.argv.includes('--capture-peat-grapes');
const captureCoal = process.argv.includes('--capture-coal');
const captureOre = process.argv.includes('--capture-ore');
const expectLedges = process.env.VITE_ENABLE_LEDGES === 'true';
const captureUI = process.argv.includes('--capture-ui');
const captureAgriculture = process.argv.includes('--capture-agriculture');
const captureAI = process.argv.includes('--capture-ai');
const captureMilitary = process.argv.includes('--capture-military');
const captureArms = process.argv.includes('--capture-arms');
const captureOffensive = process.argv.includes('--capture-offensive');
const captureBuildings = process.argv.includes('--capture-buildings');
const captureScoutTowers = process.argv.includes('--capture-scout-towers');
const checkScoutScenarios = process.argv.includes('--check-scout-scenarios');
const captureMenu = process.argv.includes('--capture-menu');
const captureArt = process.argv.includes('--capture-art');
const captureCannonFire = process.argv.includes('--capture-cannon-fire');
const captureMeadow = process.argv.includes('--capture-meadow');
const captureShellImpact = process.argv.includes('--capture-shell-impact');
const captureFeedback = process.argv.includes('--capture-feedback');
const captureCivicArt = process.argv.includes('--capture-civic-art');
const captureCivic = process.argv.includes('--capture-civic');
const captureAnalytics = process.argv.includes('--capture-analytics');
const started = performance.now(), errors = [];
// Vite treats port 0 as its default port. Choose an unused port explicitly.
const listener = createPortListener();
await new Promise((resolve, reject) => {
  listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve);
});
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
// Concurrent dev servers must not replace this check's optimized modules.
const startupCache = `output/startup/.vite-${process.pid}`;
const server = await createServer({ envFile: false, cacheDir: startupCache,
  server: { host: '127.0.0.1', port, strictPort: true, open: false, hmr: false } });
let browser, page, timer;
try {
  await server.listen();
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'],
    executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
  page = await browser.newPage({ viewport: worldViewer ? { width: 1440, height: 960 } : { width: 800, height: 600 } });
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(4096);
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      try { return await decode.call(this); }
      catch (error) { throw new Error(`Image decode failed: ${this.currentSrc || this.src}`, { cause: error }); }
    };
  });
  const failure = new Promise((_, reject) => {
    const fail = message => { errors.push(message); reject(new Error(message)); };
    page.on('pageerror', error => fail(error.stack || String(error)));
    page.on('crash', () => fail('Browser page crashed'));
    page.on('console', message => {
      if (message.type() === 'error') fail(`${message.text()} ${message.location().url}`.trim());
    });
    page.on('requestfailed', request => fail(`${request.failure()?.errorText} ${request.url()}`));
    page.on('response', response => {
      if (response.status() >= 400) fail(`HTTP ${response.status()} ${response.url()}`);
    });
    timer = setTimeout(() => fail('Startup exceeded 30 seconds'), 30_000);
  });
  await Promise.race([failure, (async () => {
    // Attach errors before navigation and avoid networkidle's mandatory delay.
    await page.goto(`${server.resolvedUrls.local[0]}${worldViewer ? 'world.html?preset=archipelago&seed=world-viewer-review' : ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      if (document.documentElement.dataset.assets === 'error') throw new Error('Game asset loading failed');
      return document.documentElement.dataset.assets === 'ready';
    });
    const defenses = await page.evaluate(async viewerMode => {
      const state = viewerMode ? window.__worldViewer.state : window.__game.state;
      const { isHumanFaction } = await import('/src/game/player-context.ts');
      const { buildingMaintenance, watchtowerMaintenance, WATCHTOWER_MAINTENANCE } = await import('/src/game/maintenance.ts');
      const ai = new Set(state.factions.filter(faction => faction.id >= 0 && faction.villageId === undefined
        && !isHumanFaction(state, faction.id)).map(faction => faction.id));
      const towers = state.buildings.filter(building => ai.has(building.faction) && building.kind === 'woodenTower');
      return { towers: towers.length,
        palisades: state.buildings.filter(building => ai.has(building.faction) && building.kind === 'palisade').length,
        charged: towers.filter(tower => buildingMaintenance(state, tower) !== 0).length,
        reserved: towers.filter(tower => watchtowerMaintenance(state, tower.faction, tower.kind) !== 0).length,
        humanRate: WATCHTOWER_MAINTENANCE };
    }, worldViewer);
    assert.ok(defenses.towers > 0, 'AI starting wooden towers must remain');
    assert.equal(defenses.palisades, 0, 'AI starting towers must not have palisade rings');
    assert.equal(defenses.charged, 0, 'AI wooden towers must not charge upkeep');
    assert.equal(defenses.reserved, 0, 'AI tower forecasts must not reserve upkeep');
    assert.equal(defenses.humanRate, 5, 'Human watchtower upkeep must retain its normal rate');
    const scoutTowers = await page.evaluate(async viewerMode => {
      const state = viewerMode ? window.__worldViewer.state : window.__game.state;
      const { validateBuildAt, BUILD_COSTS } = await import('/src/game/simulation.ts');
      const { buildingReady, BUILDABLE_KINDS } = await import('/src/game/types.ts');
      const { entityStore } = await import('/src/game/entity-store.ts');
      const { buildingSightRadius, updateFog } = await import('/src/game/fog.ts');
      const store = entityStore(state);
      const armed = new Set(store.buildings.query('towerWeapon'));
      const towers = state.buildings.filter(b => b.kind === 'scoutTower');
      const townByFaction = new Map(store.buildings.query('palace').filter(b => b.initialCity).map(b => [b.faction, b]));
      const byFaction = new Map([...townByFaction].map(([faction]) => [faction, 0]));
      for (const tower of towers) byFaction.set(tower.faction, (byFaction.get(tower.faction) ?? 0) + 1);
      const fog = viewerMode ? undefined : updateFog(state, 0);
      const player = towers.filter(b => b.faction === 0);
      return {
        counts: [...byFaction.values()],
        healthy: towers.every(tower => buildingReady(tower) && tower.hp === 75 && tower.armor === 0 && !armed.has(tower)),
        outside: towers.every(tower => {
          const town = townByFaction.get(tower.faction);
          const distance = town && Math.hypot(tower.x - town.x - .5, tower.y - town.y - .5);
          return distance >= 7 && distance <= 12;
        }),
        radius: buildingSightRadius({ kind: 'scoutTower' }),
        sight: !fog || player.every(tower => fog.sources.some(source =>
          source.x === tower.x + .5 && source.y === tower.y + .5 && source.radius === buildingSightRadius(tower))),
        buildable: BUILDABLE_KINDS.includes('scoutTower') || validateBuildAt(state, 'scoutTower', player[0]?.x ?? 0, player[0]?.y ?? 0).ok,
        cost: Object.values(BUILD_COSTS.scoutTower).reduce((sum, amount) => sum + amount, 0),
      };
    }, worldViewer);
    assert.ok(scoutTowers.counts.length && scoutTowers.counts.every(count => count >= 2 && count <= 4),
      `Each starting faction should have multiple scout towers where the startup terrain allows (${scoutTowers.counts})`);
    assert.ok(scoutTowers.healthy && scoutTowers.outside && scoutTowers.sight, 'Scout towers must be fragile, unarmed sight sources around the city');
    assert.equal(scoutTowers.radius, 13, 'Scout towers must have a 13-tile sight radius');
    assert.ok(!scoutTowers.buildable && scoutTowers.cost === 0, 'Scout towers must be restricted to free rebuilds');
    const staffing = await page.evaluate(async viewerMode => {
      const state = viewerMode ? window.__worldViewer.state : window.__game.state;
      const { entityStore } = await import('/src/game/entity-store.ts');
      const units = entityStore(state).units;
      const actors = new Set(units.query('unit'));
      const workers = units.query('worker');
      return {
        dormant: workers.filter(unit => unit.hp > 0 && unit.inside && !actors.has(unit)).length,
        missingOutside: workers.filter(unit => unit.hp > 0 && !unit.inside && !actors.has(unit)).length,
      };
    }, worldViewer);
    assert.ok(staffing.dormant > 0, 'Starting civilian jobs should include dormant slots without native actors');
    assert.equal(staffing.missingOutside, 0, 'Every exposed worker must have a native actor');
    const landscape = await page.evaluate(async viewerMode => {
      const { world } = viewerMode ? window.__worldViewer.state : window.__game.state;
      const [{ visibleReliefStamps }, { reliefFootprintAllowed }, { ridgeIsLedge, STAIR_UP },
        { ridgeQuads }, { terrainQuads }, { canTraverseEdge, traversable }] = await Promise.all([
        import('/src/game/relief-art.ts'), import('/src/game/relief.ts'), import('/src/game/ridges.ts'),
        import('/src/game/ridge-art.ts'), import('/src/game/terrain.ts'), import('/src/game/pathfinding.ts'),
      ]);
      const minerals = new Set(), stairsByShelf = new Map();
      let reliefCells = 0, stairs = 0, faces = 0, invalidFaces = 0, invalidStairs = 0;
      let mixedTerrain = 0, painted = false;
      for (const [cell, tile] of world.tiles.entries()) {
        reliefCells += Number(!!tile.relief);
        stairs += Number(!!tile.stair);
        if (tile.oreAnchor !== undefined && ['copper', 'iron', 'gold'].includes(tile.resource)) minerals.add(tile.resource);
        if (!tile.ridge) continue;
        const x = cell % world.width, y = Math.floor(cell / world.width);
        stairsByShelf.set(tile.ridge, (stairsByShelf.get(tile.ridge) ?? 0) + Number(!!tile.stair));
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          mixedTerrain += Number(world.tiles[(y + dy) * world.width + x + dx]?.terrain !== tile.terrain);
        }
        if (tile.stair) {
          const up = STAIR_UP[tile.stair], low = { x: x - up.x, y: y - up.y }, high = { x: x + up.x, y: y + up.y };
          invalidStairs += Number(!traversable(world, low.x, low.y) || !traversable(world, high.x, high.y)
            || !canTraverseEdge(world, low, { x, y }) || !canTraverseEdge(world, { x, y }, high));
        }
        if (!ridgeIsLedge(world, x, y)) continue;
        faces++;
        invalidFaces += Number(traversable(world, x, y) || reliefFootprintAllowed(world, x, y)
          || reliefFootprintAllowed(world, x, y, 1, 1, true));
        if (!painted) painted = JSON.stringify(terrainQuads(world, x, y)) === JSON.stringify(ridgeQuads(world, x, y));
      }
      return { reliefCells, minerals: [...minerals].sort(), faces, invalidFaces, invalidStairs, mixedTerrain, painted,
        stairs, stairsByShelf: [...stairsByShelf.values()], reliefStamps: visibleReliefStamps(world, 0, 0, world.width, world.height).length };
    }, worldViewer);
    assert.equal(landscape.reliefCells, 0, 'Generated terrain must have no hills or mountains');
    assert.equal(landscape.reliefStamps, 0, 'Generated terrain must have no hill or mountain sprites');
    assert.deepEqual(landscape.minerals, ['copper', 'gold', 'iron'], 'Generated terrain must retain all ore types');
    if (expectLedges) {
      assert.ok(landscape.faces && landscape.stairs, 'The feature flag must enable ledges and stairs');
      assert.ok(landscape.stairsByShelf.every(count => count === 1), 'Every shelf must have one stair');
      assert.equal(landscape.mixedTerrain, 0, 'Each ledge and its apron must be on a single terrain type');
      assert.equal(landscape.invalidStairs, 0, 'Stairs must connect walkable ground with the summit');
      assert.equal(landscape.invalidFaces, 0, 'Ledge faces must block walking and construction');
      assert.ok(landscape.painted, 'Terrain must paint the native ledge face');
    } else {
      assert.equal(landscape.stairsByShelf.length, 0, 'Ledge shelves must be off by default');
      assert.equal(landscape.stairs, 0, 'Stairs must be off by default');
    }
    if (worldViewer) {
      await page.waitForFunction(() => document.documentElement.dataset.worldViewer === 'ready');
      const meadow = await page.evaluate(async () => {
        const { world } = window.__worldViewer.state;
        const { width, height, tiles } = world;
        const { MeadowPlacementCache, MEADOW_SPRITES, MEADOW_TUFT_SCALE } = await import('/src/game/meadow-art.ts');
        const { worldRevisions } = await import('/src/game/world-revisions.ts');
        const cache = new MeadowPlacementCache(), geometry = worldRevisions(world).geometry;
        const { ridgeIsLedge } = await import('/src/game/ridges.ts');
        const protectedCells = tiles.map((tile, cell) => !!tile.stair || ridgeIsLedge(world, cell % width, Math.floor(cell / width)));
        let grass = 0, overlaps = 0;
        for (let cell = 0; cell < tiles.length; cell++) {
          const x = cell % width, y = Math.floor(cell / width);
          for (const tuft of cache.get(world, x, y, geometry)) {
            grass++;
            const left = x + tuft.x - MEADOW_TUFT_SCALE * .5;
            const top = y + tuft.y - MEADOW_SPRITES[tuft.variant].anchorY * MEADOW_TUFT_SCALE;
            for (let ny = Math.max(0, Math.floor(top)); ny < Math.min(height, top + MEADOW_TUFT_SCALE); ny++) {
              for (let nx = Math.max(0, Math.floor(left)); nx < Math.min(width, left + MEADOW_TUFT_SCALE); nx++) {
                if (protectedCells[ny * width + nx]) overlaps++;
              }
            }
          }
        }
        return { grass, overlaps };
      });
      assert.ok(meadow.grass > 0, 'Walkable terrain must retain decorative grass');
      assert.equal(meadow.overlaps, 0, 'Decorative grass must stay clear of ledges and stairs');
      const woodland = await page.evaluate(async () => {
        const { applyTerrainEcology } = await import('/src/world/terrain-ecology.ts');
        const { resolveLandscapeParameters } = await import('/src/world/options.ts');
        const { ridgeIsLedge } = await import('/src/game/ridges.ts');
        const { canTraverseEdge, traversable } = await import('/src/game/pathfinding.ts');
        const { WATER } = await import('/src/game/types.ts');
        const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const inspect = world => {
          const { width, height, tiles } = world;
          const trees = Uint8Array.from(tiles, tile => Number(tile.overlay === 'forest' || tile.overlay === 'jungle'));
          let count = 0, solidCanopy = 0, clearings = 0, withoutOpening = 0, obstructedTerrain = 0;
          const blocked = [];
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const cell = y * width + x;
            if (x + 1 < width && y + 1 < height) {
              const canopy = trees[cell] + trees[cell + 1] + trees[cell + width] + trees[cell + width + 1];
              solidCanopy += Number(canopy === 4);
              clearings += Number(canopy === 0);
            }
            if (!trees[cell]) continue;
            count++;
            obstructedTerrain += Number(!!tiles[cell].stair || !!tiles[cell].waterfall || ridgeIsLedge(world, x, y));
            if (!directions.some(([dx, dy]) => {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
              const next = ny * width + nx;
              return !trees[next] && !WATER.has(tiles[next].terrain) && traversable(world, nx, ny)
                && canTraverseEdge(world, { x, y }, { x: nx, y: ny });
            })) {
              withoutOpening++;
              if (blocked.length < 5) blocked.push([x, y]);
            }
          }
          return { trees, count, solidCanopy, clearings, withoutOpening, obstructedTerrain, blocked };
        };
        // An even, wet site exercises local spacing without coastlines or
        // differences in habitat creating forest edges of their own.
        const size = 64;
        const wet = { width: size, height: size, seed: 'startup-wet-woodland', source: 'startup', spawns: [],
          tiles: Array.from({ length: size * size }, () => ({ terrain: 'grassland', overlay: 'none', biome: 'rainforest',
            moisture: 1, temperature: .8, elevation: .3, variation: .5, food: 3, production: 1, gold: 0 })) };
        applyTerrainEcology(wet, resolveLandscapeParameters({ forestThreshold: .48, forestNorthBias: .06 }));
        const { trees, ...wetStats } = inspect(wet);
        const density = wetStats.count / trees.length;
        const block = 4, blockArea = block ** 2;
        let squaredDeviation = 0;
        for (let y = 0; y < size; y += block) for (let x = 0; x < size; x += block) {
          let canopy = 0;
          for (let dy = 0; dy < block; dy++) for (let dx = 0; dx < block; dx++) canopy += trees[(y + dy) * size + x + dx];
          squaredDeviation += (canopy - blockArea * density) ** 2;
        }
        const variance = squaredDeviation / (size / block) ** 2;
        const independentVariance = blockArea * density * (1 - density);
        const clearingShare = wetStats.clearings / (size - 1) ** 2;
        const { trees: _, ...generated } = inspect(window.__worldViewer.state.world);
        return { generated, wet: { ...wetStats, density, dispersion: variance / independentVariance,
          excessClearings: clearingShare - (1 - density) ** 4 } };
      });
      assert.ok(woodland.generated.count > 0, 'Generated terrain must retain forests');
      for (const landscape of [woodland.generated, woodland.wet]) {
        assert.equal(landscape.solidCanopy, 0, 'Woodland must avoid solid 2×2 canopy');
        assert.equal(landscape.withoutOpening, 0, `Every tree must border a walkable opening (${JSON.stringify(landscape.blocked)})`);
        assert.equal(landscape.obstructedTerrain, 0, 'Trees must stay off ledge faces, stairs and waterfalls');
      }
      assert.ok(woodland.wet.density > .3, 'Wet woodland must retain substantial stands');
      assert.ok(woodland.wet.dispersion > 1.25, `Wet woodland should cluster at a local scale (${woodland.wet.dispersion.toFixed(2)})`);
      assert.ok(woodland.wet.excessClearings > .02, `Wet woodland should retain small clearings (${woodland.wet.excessClearings.toFixed(3)})`);
      const result = await page.evaluate(async () => {
        const viewer = window.__worldViewer, state = viewer?.state, renderer = viewer?.renderer;
        if (!state?.units.length || !state.buildings.length) throw new Error('Viewer initial world is empty');
        const { isMapRevealed, presentationFog } = await import('/src/game/fog.ts');
        const fog = presentationFog(state), top = renderer.screenPoint({ x: 0, y: 0 });
        const bottom = renderer.screenPoint({ x: state.world.width, y: state.world.height });
        return { fonts: document.documentElement.dataset.fonts, revealed: isMapRevealed(state) && fog.explored.every(Boolean),
          paused: state.paused && state.time === 0, fits: top.x >= 0 && top.y >= 0 && bottom.x <= renderer.width && bottom.y <= renderer.height,
          sprites: renderer.renderStats.sprites, menu: !!document.querySelector('.frontend'),
          parameters: state.world.generationParameters,
          displayedDensity: Number(document.querySelector('[data-parameter="islandDensity"]').value) };
      });
      assert.equal(result.fonts, 'ready');
      assert.ok(result.revealed, 'Viewer map must be fully revealed');
      assert.ok(result.paused, 'Viewer must keep the initial world frozen');
      assert.ok(result.fits, 'Whole map must fit on the first screen');
      assert.ok(result.sprites > 0, 'Viewer renderer must paint the world');
      assert.equal(result.menu, false, 'Viewer must start without the menu');
      assert.equal(result.parameters.islandDensity, 1.8, 'Viewer must use the game archipelago preset');
      assert.equal(result.displayedDensity, result.parameters.islandDensity, 'Controls must show the generated settings');
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/world-viewer.png' });
      if (captureLedges) {
        await page.evaluate(() => {
          const { state, renderer } = window.__worldViewer;
          const { tiles, width, spawns, secondarySpawns } = state.world;
          const towns = [...spawns, ...secondarySpawns ?? []];
          let focus, best = Infinity;
          for (const [cell, tile] of tiles.entries()) {
            if (!tile.stair) continue;
            const x = cell % width + .5, y = Math.floor(cell / width) + .5;
            const score = Math.min(...towns.map(town => Math.hypot(town.x - x, town.y - y)))
              + (tile.stair === 'north' ? 0 : 12);
            if (score < best) { focus = { x, y }; best = score; }
          }
          if (!focus) throw new Error('Ledge capture requires an enabled shelf.');
          renderer.camera = focus;
          renderer.zoom = 1.25;
          renderer.draw(state, 0);
        });
        await page.locator('#world-view').screenshot({ path: 'output/startup/ledges-enabled.png' });
      }
      if (captureQuarry) {
        const quarry = await page.evaluate(async () => {
          const { state, renderer } = window.__worldViewer;
          const { width, tiles } = state.world;
          const { buildResourceArtLayout, drawResourceObject } = await import('/src/game/resource-art.ts');
          const { isSiteMaterial, ORE_FORMATION_COUNT } = await import('/src/game/ore-art.ts');
          const groups = new Map();
          for (const [cell, tile] of tiles.entries()) {
            if (tile.resource !== 'stone') continue;
            const key = tile.resourceGroup ?? cell;
            const group = groups.get(key) ?? [];
            group.push(cell);
            groups.set(key, group);
          }
          const cells = [...groups.values()].sort((a, b) => b.length - a.length)[0];
          if (!cells) throw new Error('Quarry capture requires a stone deposit.');
          const layout = buildResourceArtLayout(state.world);
          const first = layout.get(cells[0]), clump = first?.ore;
          const deposits = [...layout.values()].filter(art => art.oreDraw && art.ore && !isSiteMaterial(art.ore.material)).map(art => art.ore);
          const selectedShapes = ORE_FORMATION_COUNT === 6 && deposits.every(ore => Number.isInteger(ore.formation)
            && ore.formation >= 0 && ore.formation < ORE_FORMATION_COUNT);
          const compactOre = tiles.every(tile => tile.oreAnchor === undefined || tile.oreWidth <= 5 && tile.oreHeight <= 3);
          if (!clump || clump.material !== 'stone') throw new Error('The quarry is missing its stone formation.');
          const canvas = document.createElement('canvas');
          canvas.width = clump.width * 16;
          canvas.height = clump.height * 16;
          const context = canvas.getContext('2d');
          drawResourceObject(context, first, 0, 0, 16);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let left = canvas.width, right = -1;
          for (let cell = 0; cell < canvas.width * canvas.height; cell++) {
            if (!pixels[cell * 4 + 3]) continue;
            const x = cell % canvas.width;
            left = Math.min(left, x); right = Math.max(right, x);
          }
          renderer.camera = { x: clump.x + clump.width / 2, y: clump.y + clump.height / 2 };
          renderer.zoom = 1.6;
          renderer.draw(state, 0);
          return { compactOre, selectedShapes, renderedWidth: right - left + 1, shared: cells.every(cell => layout.get(cell)?.ore === clump),
            draws: cells.filter(cell => layout.get(cell)?.oreDraw).length };
        });
        assert.ok(quarry.shared && quarry.draws === 1 && quarry.renderedWidth > 16, 'Quarries must render one multi-tile formation per deposit');
        await page.locator('#world-view').screenshot({ path: 'output/startup/quarry-outcrop.png' });
        assert.ok(quarry.selectedShapes, 'Natural deposits must use only the six selected outcrops');
        assert.ok(quarry.compactOre, 'World generation must use the standard ore footprints');
      }
      if (captureMarble) {
        const marble = await page.evaluate(() => {
          const { world } = window.__worldViewer.state;
          const { spawns, secondarySpawns = [], tiles, width } = world;
          const starts = [...spawns.map((point, faction) => ({ point, faction })),
            ...secondarySpawns.map((point, index) => ({ point, faction: index + 1 }))];
          const anchors = tiles.flatMap((tile, cell) => tile.resource === 'marble' && tile.oreAnchor === cell
            && !tile.resourceDeveloped ? [cell] : []);
          const regions = anchors.map(cell => {
            const x = cell % width, y = Math.floor(cell / width);
            const distance = point => (x - Math.floor(point.x)) ** 2 + (y - Math.floor(point.y)) ** 2;
            return starts.slice().sort((a, b) => distance(a.point) - distance(b.point) || a.faction - b.faction)[0]?.faction;
          });
          return { anchor: anchors[0], count: anchors.length, regions: new Set(regions).size };
        });
        const { anchor } = marble;
        assert.ok(anchor >= 0, 'The generated map must contain a marble quarry');
        assert.equal(marble.count, marble.regions, 'Each starting faction region may have at most one marble quarry');
        const renderQuarry = active => page.evaluate(async ({ anchor, active }) => {
          const { state, renderer } = window.__worldViewer;
          const { world } = state;
          const { buildResourceArtLayout } = await import('/src/game/resource-art.ts');
          const { markWorldChanged } = await import('/src/game/world-revisions.ts');
          const cells = [anchor, anchor + 1, anchor + world.width, anchor + world.width + 1];
          const terrain = world.tiles[anchor].terrain;
          if (!cells.every(cell => {
            const tile = world.tiles[cell];
            return tile.resource === 'marble' && tile.oreAnchor === anchor && tile.terrain === terrain;
          })) throw new Error('The marble quarry must cover four matching marble tiles.');
          for (const cell of cells) world.tiles[cell].resourceDeveloped = active;
          markWorldChanged(world, 'appearance', cells);
          const layout = buildResourceArtLayout(world);
          const quarry = layout.get(anchor)?.ore;
          if (quarry?.material !== 'marble' || quarry.width !== 2 || quarry.height !== 2 || quarry.developed !== active
            || !cells.every(cell => layout.get(cell)?.ore === quarry)
            || cells.filter(cell => layout.get(cell)?.oreDraw).length !== 1) {
            throw new Error('The marble quarry must share one 2×2 sprite in each development state.');
          }
          renderer.camera = { x: quarry.x + 1, y: quarry.y + 1 };
          renderer.zoom = 3.4;
          renderer.draw(state, 0);
        }, { anchor, active });
        try {
          for (const active of [false, true]) {
            await renderQuarry(active);
            await page.locator('#world-view').screenshot({ path: `output/startup/marble-${active ? 'active' : 'undeveloped'}.png` });
          }
        } finally {
          await renderQuarry(false);
        }
        await checkMarbleConstruction(page);
      }
      if (captureHarvest || captureCoal) {
        const sizes = { ...(captureHarvest && { peat: 2, grapes: 2 }), ...(captureCoal && { coal: 3 }) };
        await captureResourceSites(page, sizes);
        await checkResourceEconomy(page);
      }
      if (captureOre) {
        const deposits = await page.evaluate(async () => {
          const { state } = window.__worldViewer;
          const { buildResourceArtLayout } = await import('/src/game/resource-art.ts');
          const ores = [...buildResourceArtLayout(state.world).values()]
            .filter(art => art.oreDraw && art.ore && !art.ore.developed).map(art => art.ore);
          return ['copper', 'iron', 'gold'].map(material => {
            const matches = ores.filter(ore => ore.material === material);
            const area = ore => ore.width * ore.height;
            matches.sort((a, b) => area(b) - area(a)
              || Number(b.palette === 'grassland') - Number(a.palette === 'grassland'));
            const ore = matches[0];
            if (!ore) throw new Error(`Ore capture requires a ${material} deposit.`);
            return { material, camera: { x: ore.x + ore.width / 2, y: ore.y + ore.height / 2 } };
          });
        });
        for (const { material, camera } of deposits) {
          await page.evaluate(camera => {
            const { renderer, state } = window.__worldViewer;
            renderer.camera = camera;
            renderer.zoom = 2.35;
            renderer.draw(state, 0);
          }, camera);
          await page.locator('#world-view').screenshot({ path: `output/startup/ore-${material}.png` });
        }
      }
      if (captureAI) {
        // Photograph the initial AI city in the frozen viewer, without gameplay.
        await page.evaluate(() => {
          const { state, renderer } = window.__worldViewer;
          const city = state.buildings.find(building => building.kind === 'palace' && building.faction > 0 && building.villageId === undefined);
          renderer.camera = { x: city.x + 1, y: city.y + 1 };
          renderer.zoom = 1.4; renderer.draw(state, 0);
        });
        await page.screenshot({ path: 'output/startup/ai-start.png' });
      }
      if (captureAgriculture) {
        const agriculture = await page.evaluate(async () => {
          await import('/src/ui/game-font.css');
          await import('/src/style.css');
          await import('/src/ui/forged-hud.css');
          const { ResearchTree } = await import('/src/ui/research-tree.ts');
          const { RESEARCH_CARD_WIDTH, researchCardPosition } = await import('/src/ui/research-tree-layout.ts');
          const { fieldHarvestYield } = await import('/src/game/farms.ts');
          const { citySummaries } = await import('/src/game/cities.ts');
          const { withSimulationReads } = await import('/src/game/simulation-reads.ts');
          const initial = window.__worldViewer.state;
          const owner = initial.factions.find(faction => faction.id === 0);
          const faction = { ...owner, villageBonuses: undefined, research: {
            focus: 'ironPlows', priorities: ['ironPlows'], progress: {},
            levels: { irrigation: 1, grainStorage: 1, woodenTower: 1, wall: 1, blacksmith: 1, metalTools: 1 },
          } };
          const state = { ...initial, world: { ...initial.world, scenario: undefined },
            factions: initial.factions.map(candidate => candidate === owner ? faction : candidate) };
          const field = state.fields.find(candidate => candidate.faction === faction.id && candidate.planted && !candidate.orchard);
          const forecast = () => withSimulationReads(state, () =>
            citySummaries(state, faction.id).reduce((sum, city) => sum + city.food, 0));
          const base = fieldHarvestYield(state, field), initialForecast = forecast();
          faction.research.levels.cropRotation = 1;
          const rotation = fieldHarvestYield(state, field) / base, rotationForecast = forecast();
          faction.research.levels.ironPlows = 1;
          const combined = fieldHarvestYield(state, field) / base, combinedForecast = forecast();
          delete faction.research.levels.ironPlows;

          const popup = document.createElement('section');
          popup.className = 'building-activity is-library';
          popup.dataset.startupAgriculture = '';
          popup.style.cssText = 'position:fixed;z-index:100;left:50%;top:50%;transform:translate(-50%,-50%)';
          popup.innerHTML = '<h2>Research</h2><div class="activity-research"></div>';
          document.body.append(popup);
          const tree = new ResearchTree(popup.querySelector('.activity-research'), { allocate() {}, prioritize() {}, remove() {} });
          tree.refresh(state, { faction: faction.id });
          const scroller = popup.querySelector('.research-tree-scroll');
          scroller.scrollLeft = researchCardPosition('ironPlows').left + RESEARCH_CARD_WIDTH - scroller.clientWidth + 16;
          await Promise.all([...popup.querySelectorAll('img')].map(image => image.decode()));
          await document.fonts.ready;
          const card = id => popup.querySelector(`[data-research="${id}"]`);
          const cost = id => Number(card(id).querySelector('.research-cost-number').textContent);
          return { costs: [cost('cropRotation'), cost('ironPlows')], rotation, combined,
            forecastsIncrease: initialForecast < rotationForecast && rotationForecast < combinedForecast,
            effects: [card('cropRotation').title, card('ironPlows').title],
            pricesFit: ['cropRotation', 'ironPlows'].every(id =>
              card(id).querySelector('.research-cost-number').getBoundingClientRect().bottom <= card(id).getBoundingClientRect().bottom) };
        });
        assert.deepEqual(agriculture.costs, [60, 90]);
        assert.ok(Math.abs(agriculture.rotation - 1.15) < 1e-9);
        assert.ok(Math.abs(agriculture.combined - 1.35) < 1e-9);
        assert.ok(agriculture.forecastsIncrease, 'City food projections should refresh after each research upgrade');
        assert.match(agriculture.effects[0], /\+15% farm yield/);
        assert.match(agriculture.effects[1], /\+20% farm yield/);
        assert.match(agriculture.effects[0], /Requires Grain Storage/);
        assert.match(agriculture.effects[1], /Requires Crop Rotation and Metal Tools/);
        assert.ok(agriculture.pricesFit, 'The new research prices should fit inside their cards');
        const popup = page.locator('[data-startup-agriculture]');
        await popup.screenshot({ path: 'output/startup/agriculture-research.png' });
        const viewport = page.viewportSize();
        const board = await popup.locator('.research-board').boundingBox();
        await page.setViewportSize({ width: Math.ceil(board.width + 110), height: Math.ceil(board.height + 470) });
        await popup.evaluate((element, board) => {
          element.style.width = `${board.width + 78}px`;
          element.style.height = `${board.height + 340}px`;
          element.style.maxHeight = 'none';
          element.querySelector('.research-tree-scroll').scrollTo(0, 0);
        }, board);
        await popup.screenshot({ path: 'output/startup/research-tree-overview.png' });
        await popup.evaluate(element => element.remove());
        await page.setViewportSize(viewport);
      }
      if (captureUI) {
        // Render the real frontend over the frozen viewer for UI screenshots.
        // This never starts a scenario or drives gameplay.
        await page.evaluate(async () => {
          const { Frontend } = await import('/src/ui/frontend.ts');
          const host = document.createElement('div'); document.body.append(host);
          let quickStart;
          const preview = new Frontend(host, action => { if (action.type === 'new') quickStart = action.options; });
          preview.setSettings({ zoom: 1, minZoom: .55, maxZoom: 3, follow: true, fullscreen: false,
            banditIntensity: 0, enemyStrength: 1, autoRebuildDefenses: true });
          preview.show('main');
          host.querySelector('[data-frontend-action="quick"]').click();
          if (quickStart?.banditIntensity !== 1) throw new Error('Quick Start must use Roaming barbarians');
          preview.show('scenarios');
          const sandbox = host.querySelector('[data-select-scenario="sandbox"]');
          sandbox.focus(); sandbox.click();
          await Promise.all([...host.querySelectorAll('img')].map(image => image.decode()));
          window.__startupUI = preview;
        });
        await page.screenshot({ path: 'output/startup/sandbox.png' });
        await page.evaluate(() => window.__startupUI.loading('Generating world...', '', .67));
        const loading = await page.locator('.frontend-loading.menu-sheet').evaluate(element => {
          const bar = element.querySelector('progress');
          return { title: element.querySelector('#frontend-title').textContent, value: bar.value, width: bar.clientWidth };
        });
        assert.equal(loading.title, 'Generating world...');
        assert.equal(loading.value, .67);
        assert.ok(loading.width > 100, 'The progress bar must be visible');
        await page.screenshot({ path: 'output/startup/loading.png' });
      }
      if (captureArms) await captureArmsPreview(page);
      if (process.argv.includes('--capture-battlefield-effects')) {
        const { captureBattlefieldEffects } = await import('./startup-battlefield-effects-preview.mjs');
        await captureBattlefieldEffects(page);
      }
      return;
    }
    await page.getByRole('button', { name: 'Continue as guest', exact: true }).waitFor();
    await page.evaluate(() => {
      const game = window.__game;
      if (!game?.state.units.length || !game.state.buildings.length) throw new Error('Initial world is empty');
      if (document.documentElement.dataset.fonts !== 'ready') throw new Error('Game fonts are not ready');
      window.__startup = { frames: 0, time: game.state.time };
      const draw = game.renderer.draw;
      game.renderer.draw = function (...args) { draw.apply(this, args); window.__startup.frames++; };
      game.state.paused = false;
      game.replaceState(game.state);
    });
    await page.waitForFunction(() => window.__startup.frames >= 2
      && window.__game.state.time > window.__startup.time);
    const painted = await page.evaluate(() => {
      const renderer = window.__game.renderer;
      const sample = document.createElement('canvas'); sample.width = sample.height = 16;
      const context = sample.getContext('2d');
      context.drawImage(renderer.snapshot(), 0, 0, 16, 16);
      const pixels = context.getImageData(0, 0, 16, 16).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return renderer.renderStats.sprites > 0 && colors.size > 1;
    });
    assert.ok(painted, 'World renderer produced an empty or uniform frame');
    if (captureMenu) {
      await page.setViewportSize({ width: 1280, height: 960 });
      await page.evaluate(async () => {
        window.__game.state.paused = true;
        const { Frontend } = await import('/src/ui/frontend.ts');
        const host = document.createElement('div'); document.body.append(host);
        const preview = new Frontend(host, () => {});
        preview.setSession(true, false); preview.show('main');
        await Promise.all([...host.querySelectorAll('img')].map(image => image.decode()));
        window.__menuReview = { preview, host };
      });
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/main-menu-account.png' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: 'output/startup/main-menu-account-mobile.png' });
      await page.evaluate(() => { window.__menuReview.host.remove(); });
    }
    if (captureFeedback) await captureFeedbackPreview(page);
    if (captureArms) await captureArmsPreview(page);
    if (captureOffensive) await captureOffensivePreview(page);
    if (captureBuildings) await captureBuildingPreview(page);
    if (process.argv.includes('--capture-fountain')) {
      const { captureFountainPreview } = await import('./startup-fountain-preview.mjs');
      await captureFountainPreview(page);
    }
    if (process.argv.includes('--capture-frontier-village')) {
      const { captureFrontierVillagePreview } = await import('./startup-frontier-village-preview.mjs');
      await captureFrontierVillagePreview(page);
    }
    if (captureScoutTowers) {
      await page.setViewportSize({ width: 1360, height: 940 });
      await page.evaluate(async () => {
        const { state } = window.__game;
        const { Renderer } = await import('/src/game/renderer.ts');
        const town = state.buildings.find(b => b.kind === 'palace' && b.faction === 0 && b.initialCity);
        const towers = state.buildings.filter(b => b.kind === 'scoutTower' && b.faction === 0);
        const host = document.createElement('div');
        Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
        host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
        document.body.append(host);
        const [canvas, minimap] = host.querySelectorAll('canvas'), renderer = new Renderer(canvas, minimap);
        await renderer.initialize();
        renderer.follow = false;
        renderer.camera = { x: town.x + 1, y: town.y + 1 };
        renderer.zoom = 1.05;
        renderer.draw(state, 0);
        for (const tower of towers) {
          const { x, y } = renderer.screenPoint({ x: tower.x + .5, y: tower.y + 1.12 });
          const label = document.createElement('div');
          Object.assign(label.style, { position: 'absolute', left: `${x}px`, top: `${y}px`, transform: 'translateX(-50%)',
            padding: '3px 7px', border: '1px solid #a89059', background: '#15201aec',
            color: '#f6e3ae', font: '20px "Pixel Operator"' });
          label.textContent = 'Scout tower';
          host.append(label);
        }
      });
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/scout-towers.png' });
    }
    if (captureCivicArt) await captureCivicArtGallery(page);
    if (captureCivic) await captureCivicPreview(page);
    if (captureCannonFire) await captureCannonFirePreview(page);
    if (captureShellImpact) await captureShellImpactPreview(page);
    if (captureMeadow) await captureMeadowPreview(page);
    if (process.argv.includes('--capture-unit-trails')) {
      const { captureUnitTrailsPreview } = await import('./startup-unit-trails-preview.mjs');
      await captureUnitTrailsPreview(page);
    }
    if (captureMilitary) {
      // Use a separate frozen state and renderer for visual review. No scenario
      // is started, no gameplay input is sent, and no save is changed.
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.evaluate(async () => {
        window.__game.state.paused = true;
        const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
        const { Renderer } = await import('/src/game/renderer.ts');
        const { BuildingActivityPopup } = await import('/src/ui/building-activity.ts');
        const { constructionEdges } = await import('/src/game/builders.ts');
        const { setMapRevealed } = await import('/src/game/fog.ts');
        const state = await createScenarioGame('musketry-deathmatch');
        state.paused = true; setMapRevealed(state, true);
        const faction = state.factions.find(faction => faction.id === 0);
        const academy = state.buildings.find(building => building.faction === 0 && building.kind === 'militaryAcademy');
        const leader = state.units.find(unit => unit.faction === 0 && unit.kind === 'leader');
        if (!academy || !leader) throw new Error('Military scenario lacks its academy or Leader');
        const host = document.createElement('div');
        Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
        host.innerHTML = '<canvas style="width:100%;height:520px;display:block"></canvas><canvas hidden></canvas><section class="building-activity" role="dialog" aria-labelledby="building-activity-title" hidden></section>';
        document.body.append(host);
        const [canvas, minimap] = host.querySelectorAll('canvas');
        const renderer = new Renderer(canvas, minimap); await renderer.initialize();
        renderer.follow = false;
        renderer.camera = { x: state.world.width / 2, y: state.world.height / 2 };
        renderer.zoom = Math.min(1400 / (state.world.width * 32), 900 / (state.world.height * 32));
        renderer.draw(state, 0);
        window.__militaryReview = { state, renderer, host, academy, leader, faction, BuildingActivityPopup, constructionEdges };
      });
      await mkdir('output/startup', { recursive: true });
      await page.screenshot({ path: 'output/startup/musketry-deathmatch.png', clip: { x: 0, y: 0, width: 1440, height: 520 } });
      await page.evaluate(() => {
        const { state, renderer, host, academy, leader, faction, BuildingActivityPopup, constructionEdges } = window.__militaryReview;
        host.querySelector('canvas').style.height = '100%'; renderer.resize();
        faction.formationType = 'wide';
        const edge = constructionEdges(state, academy)[0];
        if (!edge) throw new Error('Military Academy has no accessible entrance');
        leader.x = edge.x; leader.y = edge.y; leader.inside = undefined;
        leader.facing = 0;
        renderer.camera = { x: academy.x + 2, y: academy.y + 2.5 }; renderer.zoom = 2;
        renderer.draw(state, 0);
        const popup = new BuildingActivityPopup(host.querySelector('section'), () => state,
          point => renderer.screenPoint(point), () => ({ width: renderer.width, height: renderer.height }), () => {}, () => {});
        popup.toggle(academy); window.__militaryReview.popup = popup;
      });
      await page.screenshot({ path: 'output/startup/military-academy.png' });
    }
  })()]);
  clearTimeout(timer);
  if (checkScoutScenarios) {
    const counts = await page.evaluate(async () => {
      const { SCENARIOS } = await import('/src/game/scenario-content.ts');
      const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
      const result = {};
      for (const { id } of SCENARIOS) {
        const state = await createScenarioGame(id);
        const factions = new Map(state.buildings.filter(b => b.kind === 'palace' && b.initialCity).map(b => [b.faction, 0]));
        for (const tower of state.buildings) if (tower.kind === 'scoutTower')
          factions.set(tower.faction, (factions.get(tower.faction) ?? 0) + 1);
        result[id] = [...factions.values()];
      }
      return result;
    });
    for (const [id, factions] of Object.entries(counts))
      assert.ok(factions.length && factions.every(count => count >= 2 && count <= 4), `${id} scout towers by faction: ${factions}`);
    console.log('Scout towers in scenario starts:', counts);
  }
  if (captureArt) {
    const { captureRuntimeArtReview } = await import('../tools/runtime-art/verify.mjs');
    await captureRuntimeArtReview(browser, server.resolvedUrls.local[0]);
  }
  if (captureAnalytics) await captureAnalyticsPreview(browser, server.resolvedUrls.local[0]);
  console.log(`PASS startup: ${worldViewer ? 'world viewer, full reveal, frozen world, fit camera and screenshot' : 'browser imports, assets, fonts, simulation and world rendering'} (${((performance.now() - started) / 1000).toFixed(1)}s)`);
} catch (error) {
  await mkdir('output/startup', { recursive: true });
  await Promise.allSettled([
    writeFile('output/startup/error.log', [error.stack || String(error), ...errors].join('\n')),
    page?.screenshot({ path: 'output/startup/failure.png', timeout: 2000 }),
  ]);
  throw error;
} finally {
  clearTimeout(timer);
  await browser?.close();
  await server.close();
  await rm(startupCache, { recursive: true, force: true });
}

async function captureResourceSites(page, sizes) {
  const anchors = await page.evaluate(resources => {
    const { tiles } = window.__worldViewer.state.world;
    return Object.fromEntries(resources.map(resource => [resource,
      tiles.flatMap((tile, cell) => tile.resource === resource && tile.oreAnchor === cell ? [cell] : [])]));
  }, Object.keys(sizes));
  const renderSite = (resource, anchor, size, developed) => page.evaluate(async ({ resource, anchor, size, developed }) => {
    const { state, renderer } = window.__worldViewer;
    const { world } = state, { width, tiles } = world;
    const { buildResourceArtLayout } = await import('/src/game/resource-art.ts');
    const { markWorldChanged } = await import('/src/game/world-revisions.ts');
    const cells = Array.from({ length: size * size }, (_, index) => anchor + index % size + Math.floor(index / size) * width);
    const terrain = tiles[anchor].terrain;
    if (!cells.every(cell => tiles[cell].resource === resource && tiles[cell].oreAnchor === anchor
      && tiles[cell].terrain === terrain)) throw new Error(`Invalid ${resource} footprint`);
    for (const cell of cells) tiles[cell].resourceDeveloped = developed;
    markWorldChanged(world, 'appearance', cells);
    const layout = buildResourceArtLayout(world), site = layout.get(anchor)?.ore;
    if (site?.material !== resource || site.width !== size || site.height !== size || site.developed !== developed
      || !cells.every(cell => layout.get(cell)?.ore === site)
      || cells.filter(cell => layout.get(cell)?.oreDraw).length !== 1) throw new Error(`Invalid ${resource} art`);
    renderer.camera = { x: site.x + size / 2, y: site.y + size / 2 };
    renderer.zoom = 3.4;
    renderer.draw(state, 0);
  }, { resource, anchor, size, developed });
  for (const [resource, sites] of Object.entries(anchors)) {
    assert.ok(sites.length > 0 && sites.length <= 3, `Expected one to three ${resource} sites, got ${sites.length}`);
    console.log(`Generated ${sites.length} ${resource} site(s)`);
    try {
      for (const developed of [false, true]) {
        await renderSite(resource, sites[0], sizes[resource], developed);
        await page.locator('#world-view').screenshot({ path: `output/startup/${resource}-${developed ? 'developed' : 'undeveloped'}.png` });
      }
    } finally {
      await renderSite(resource, sites[0], sizes[resource], false);
    }
  }
}

/** Exercise the resource purchase and economy on a fixture while the viewer is frozen. */
async function checkResourceEconomy(page) {
  const result = await page.evaluate(async () => {
    const { state } = window.__worldViewer;
    const [{ developResourceGroup }, { revealExplorationCells }, { buildingMaintenance },
      { fieldCannonUpkeep }, { marketQuote }, { factoryIncomeQuote }, { cityTaxIncome }, { markWorldChanged }] = await Promise.all([
      import('/src/game/resource-development.ts'), import('/src/game/fog.ts'), import('/src/game/maintenance.ts'),
      import('/src/game/field-cannons-native.ts'), import('/src/game/marketplace.ts'),
      import('/src/game/factory-economy.ts'), import('/src/game/cities.ts'), import('/src/game/world-revisions.ts'),
    ]);
    const width = 32, height = 20, faction = 0;
    const palace = state.buildings.find(b => b.kind === 'palace' && b.faction === faction);
    const leader = state.units.find(u => u.kind === 'leader' && u.faction === faction);
    const owner = state.factions.find(f => f.id === faction);
    const world = { width, height, seed: 'resource-economy-startup', spawns: [{ x: 8, y: 8 }], revision: 0,
      tiles: Array.from({ length: width * height }, () => ({
        terrain: 'grassland', overlay: 'none', elevation: .45, moisture: .6, variation: .5, food: 2, production: 0, gold: 0,
      })) };
    const city = { ...palace, id: 101, x: 8, y: 8 };
    const partner = { ...city, id: 102, x: 24 };
    const factory = { ...city, id: 103, kind: 'factory', x: 8, y: 12 };
    const otherFactory = { ...factory, id: 104, x: 24 };
    const cannon = { ...leader, id: 105, kind: 'fieldCannon', fieldCannon: { supplyCity: city.id, nextUpkeepAt: 30, funded: true } };
    const fixture = { ...state, world, fog: undefined, fields: [], resourceWorkSites: [], nextResourceWorkSiteId: 1,
      factions: [{ ...owner, gold: 1000 }], buildings: [city, partner, factory, otherFactory],
      units: [{ ...leader, x: 9.5, y: 10.5 }], villages: [], hermits: [], explorationSites: [] };
    const addSite = (resource, x, y, size = 2) => {
      const anchor = y * width + x;
      const cells = Array.from({ length: size * size }, (_, index) => anchor + index % size + Math.floor(index / size) * width);
      for (const cell of cells) Object.assign(world.tiles[cell], { resource, resourceGroup: anchor,
        oreAnchor: anchor, oreWidth: size, oreHeight: size, oreFamily: size - 2 });
      return cells;
    };
    const coalCells = addSite('coal', 5, 9, 3);
    revealExplorationCells(fixture, faction, [...addSite('peat', 5, 7), ...addSite('grapes', 11, 8), ...coalCells]);
    const quote = () => marketQuote(fixture, city, partner, { distance: 30, seconds: 30 }, 75, 75, 1, 1);
    const income = () => factoryIncomeQuote(fixture)(faction, 100);
    const taxes = () => cityTaxIncome(fixture, fixture.factions[0]);
    const baseline = { factory: buildingMaintenance(fixture, factory), cannon: fieldCannonUpkeep(fixture, cannon), trade: quote(),
      factoryIncome: income(), cityTax: taxes() };
    const peat = developResourceGroup(fixture, 5, 7, faction);
    const grapes = developResourceGroup(fixture, 11, 8, faction);
    const coal = developResourceGroup(fixture, 5, 9, faction);
    const factoryIncome = income(), cityTax = taxes();
    const coalTiles = coalCells.filter(cell => world.tiles[cell].resourceDeveloped).length;
    const factoryHp = factory.hp;
    factory.hp = 0;
    const afterFactoryLoss = income();
    factory.hp = factoryHp;
    const afterFactoryReturn = income();
    for (const cell of coalCells) delete world.tiles[cell].resourceDeveloped;
    markWorldChanged(world, 'appearance', coalCells);
    return {
      baseline, peat, grapes, coal, coalTiles, factoryIncome, cityTax, afterFactoryLoss, afterFactoryReturn,
      afterCoalLoss: income(), factory: buildingMaintenance(fixture, factory), cannon: fieldCannonUpkeep(fixture, cannon),
      otherFactory: buildingMaintenance(fixture, otherFactory), trade: quote(),
    };
  });
  assert.ok(result.peat.ok && result.grapes.ok && result.coal.ok, JSON.stringify(result));
  assert.ok(result.baseline.factory > 0 && result.baseline.cannon > 0 && result.baseline.trade.outboundGold > 0);
  assert.equal(result.factory, result.baseline.factory * .7);
  assert.equal(result.cannon, result.baseline.cannon * .7);
  assert.equal(result.otherFactory, result.baseline.factory);
  assert.equal(result.trade.outboundGold, result.baseline.trade.outboundGold * 1.3);
  assert.equal(result.trade.returnGold, result.baseline.trade.returnGold);
  assert.equal(result.trade.science, result.baseline.trade.science);
  assert.equal(result.coalTiles, 9);
  assert.equal(result.baseline.factoryIncome, 140, 'Both ordinary factories contribute 20% each');
  assert.equal(result.factoryIncome, 155, 'Only the factory supplied with coal contributes 35%');
  assert.ok(result.baseline.cityTax > 0 && Math.abs(result.cityTax / result.baseline.cityTax - 155 / 140) < 1e-12,
    'Coal increases both the factory quote and settlement tax income');
  assert.equal(result.afterFactoryLoss, 120, 'Losing a supplied factory removes its contribution');
  assert.equal(result.afterFactoryReturn, 155, 'A ready factory counts again');
  assert.equal(result.afterCoalLoss, 140, 'Losing coal supply restores the ordinary factory bonus');
}

async function checkMarbleConstruction(page) {
  const result = await page.evaluate(async () => {
    const { state } = window.__worldViewer;
    const [{ buildAt, buildCostAt, BUILD_COSTS }, { planConstruction }, { constructionPreviewContext },
      { activeMarbleQuarry, developResourceGroup, resourceDevelopmentStatus }, { markWorldChanged },
      { revealExplorationCells, setMapRevealed }, { ResourceActivityPopup }] = await Promise.all([
      import('/src/game/simulation.ts'), import('/src/game/construction.ts'), import('/src/game/construction-preview-cache.ts'),
      import('/src/game/resource-development.ts'), import('/src/game/world-revisions.ts'), import('/src/game/fog.ts'),
      import('/src/ui/resource-activity.ts'),
    ]);
    const width = 20, height = 20, faction = 0;
    const capital = state.buildings.find(b => b.kind === 'palace' && b.faction === faction);
    const resident = state.units.find(u => u.kind === 'leader' && u.faction === faction);
    const owner = state.factions.find(f => f.id === faction);
    const world = { width, height, seed: 'marble-startup', spawns: [{ x: 8, y: 8 }], revision: 0,
      tiles: Array.from({ length: width * height }, () => ({
        terrain: 'grassland', overlay: 'none', elevation: .45, moisture: .5, variation: .5, food: 2, production: 0, gold: 0,
      })) };
    const fixture = { ...state, world, fog: undefined, fields: [], resourceWorkSites: [], nextResourceWorkSiteId: 1,
      factions: [{ ...owner, gold: 1000 }], buildings: [{ ...capital, x: 8, y: 8 }],
      units: [{ ...resident, x: 9.5, y: 10.5 }], villages: [], hermits: [], explorationSites: [] };
    const addQuarry = (x, y) => {
      const anchor = y * width + x, cells = [anchor, anchor + 1, anchor + width, anchor + width + 1];
      for (const cell of cells) Object.assign(world.tiles[cell], {
        resource: 'marble', resourceGroup: anchor, oreAnchor: anchor, oreWidth: 2, oreHeight: 2, oreFamily: 0,
      });
      return cells;
    };
    const primary = addQuarry(5, 7), secondary = addQuarry(11, 8);
    revealExplorationCells(fixture, faction, [...primary, ...secondary]);
    const house = { x: 8, y: 12 };
    const price = () => buildCostAt(fixture, 'house', house.x, house.y).gold;
    const base = price();
    const initialPreview = constructionPreviewContext(fixture, 'road');
    const first = developResourceGroup(fixture, 5, 7, faction, 50);
    const partial = price();
    const secondBlocked = !resourceDevelopmentStatus(fixture, 11, 8, faction).ok;
    const finished = developResourceGroup(fixture, 5, 7, faction);
    const discounted = price();
    const refreshedPreview = initialPreview !== constructionPreviewContext(fixture, 'road');
    const before = fixture.factions[0].gold;
    const denied = !developResourceGroup(fixture, 11, 8, faction).ok && fixture.factions[0].gold === before;
    const quote = planConstruction(fixture, 'house', [house]);
    const ordered = buildAt(fixture, 'house', house.x, house.y);
    const paid = before - fixture.factions[0].gold;
    const receipt = fixture.buildings.find(b => b.kind === 'house')?.construction?.paidGold;
    const workSites = fixture.resourceWorkSites.filter(site => site.resource === 'marble' && site.faction === faction).length;

    // A capture can bring an already cut deposit inside the same borders.
    for (const cell of secondary) world.tiles[cell].resourceDeveloped = true;
    markWorldChanged(world, 'appearance', secondary);
    const afterCapture = price(), chosen = activeMarbleQuarry(fixture, faction)?.anchor;
    const capturedCapital = { ...capital, x: 8, y: 8, faction: 1 };
    const transferred = { ...fixture, factions: [{ ...owner, defeated: true }, { ...owner, id: 1 }],
      buildings: [capturedCapital], units: [] };
    await import('/src/ui/game-font.css');
    await import('/src/style.css');
    await import('/src/ui/resource-activity.css');
    setMapRevealed(fixture, true);
    const host = document.createElement('section');
    host.className = 'building-activity resource-activity';
    host.dataset.marblePreview = '';
    document.body.append(host);
    const popup = new ResourceActivityPopup(host, () => fixture,
      () => ({ x: innerWidth / 2, y: innerHeight / 2 }),
      () => ({ width: innerWidth, height: innerHeight }), () => {}, () => {});
    const visibleBonus = popup.open({ x: 5.5, y: 7.5 })
      && !host.querySelector('.resource-benefit').hidden
      && host.querySelector('.resource-benefit').textContent.includes('10%');
    return {
      base, partial, discounted, cutoff: BUILD_COSTS.house.gold * .9, refreshedPreview, denied, paid, receipt,
      first, finished, quote, ordered, secondBlocked, afterCapture, chosen, expectedQuarry: primary[0], workSites, visibleBonus,
      oldOwner: buildCostAt(transferred, 'house', house.x, house.y, faction).gold,
      newOwner: buildCostAt(transferred, 'house', house.x, house.y, 1).gold,
    };
  });
  assert.ok(result.first.ok, result.first.message);
  assert.equal(result.partial, result.base, 'Partially developed marble must not change the price');
  assert.ok(result.secondBlocked, 'A partially developed quarry must reserve the faction’s single quarry');
  assert.ok(result.finished.ok, result.finished.message);
  assert.equal(result.discounted, result.cutoff);
  assert.ok(result.refreshedPreview, 'Activate a new construction quote when the quarry is completed');
  assert.ok(result.denied, 'Reject a second quarry without charging the faction');
  assert.ok(result.quote.ok, result.quote.message);
  assert.equal(result.quote.cost, result.discounted);
  assert.ok(result.ordered.ok, result.ordered.message);
  assert.ok(Math.abs(result.paid - result.discounted) < 1e-9, 'Charge the exact quoted price');
  assert.equal(result.receipt, result.discounted);
  assert.equal(result.afterCapture, result.discounted);
  assert.equal(result.chosen, result.expectedQuarry);
  assert.equal(result.oldOwner, result.base);
  assert.equal(result.newOwner, result.discounted);
  assert.equal(result.workSites, 1, 'A developed quarry has one worker site');
  assert.ok(result.visibleBonus, 'The marble popup must show its construction discount');
  await page.locator('[data-marble-preview]').screenshot({ path: 'output/startup/marble-construction-discount.png' });
  await page.locator('[data-marble-preview]').evaluate(element => element.remove());
}
