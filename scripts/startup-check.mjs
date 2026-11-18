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
const expectLedges = process.env.VITE_ENABLE_LEDGES === 'true';
const captureUI = process.argv.includes('--capture-ui');
const captureAI = process.argv.includes('--capture-ai');
const captureMilitary = process.argv.includes('--capture-military');
const captureArms = process.argv.includes('--capture-arms');
const captureOffensive = process.argv.includes('--capture-offensive');
const captureBuildings = process.argv.includes('--capture-buildings');
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
        if (tile.oreAnchor !== undefined) minerals.add(tile.resource);
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
          return { renderedWidth: right - left + 1, shared: cells.every(cell => layout.get(cell)?.ore === clump),
            draws: cells.filter(cell => layout.get(cell)?.oreDraw).length };
        });
        assert.ok(quarry.shared && quarry.draws === 1 && quarry.renderedWidth > 16, 'Quarries must render one multi-tile formation per deposit');
        await page.locator('#world-view').screenshot({ path: 'output/startup/quarry-outcrop.png' });
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
      if (captureUI) {
        // Render the real frontend over the frozen viewer for UI screenshots.
        // This never starts a scenario or drives gameplay.
        await page.evaluate(async () => {
          const { Frontend } = await import('/src/ui/frontend.ts');
          const host = document.createElement('div'); document.body.append(host);
          const preview = new Frontend(host, () => {});
          preview.show('scenarios');
          const sandbox = host.querySelector('[data-select-scenario="sandbox"]');
          sandbox.focus(); sandbox.click();
          await Promise.all([...host.querySelectorAll('img')].map(image => image.decode()));
          window.__startupUI = preview;
        });
        await page.screenshot({ path: 'output/startup/sandbox.png' });
        await page.evaluate(() => window.__startupUI.loading('Loading', '', .67));
        const text = await page.locator('.frontend-loading.menu-sheet').evaluate(element => {
          const visible = element.cloneNode(true);
          // Clipped screen-reader labels are included by browser innerText.
          visible.querySelectorAll('.frontend-loading-accessible,progress').forEach(node => node.remove());
          return visible.textContent;
        });
        assert.equal(text.trim(), '67%', 'Loading must show only the percentage beside the spinner');
        await page.screenshot({ path: 'output/startup/loading.png' });
      }
      if (captureArms) await captureArmsPreview(page);
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
    if (captureCivicArt) await captureCivicArtGallery(page);
    if (captureCivic) await captureCivicPreview(page);
    if (captureCannonFire) await captureCannonFirePreview(page);
    if (captureShellImpact) await captureShellImpactPreview(page);
    if (captureMeadow) await captureMeadowPreview(page);
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
