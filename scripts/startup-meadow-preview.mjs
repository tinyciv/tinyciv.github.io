import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

/** Production renderer on a detached, frozen baked world. No input or sim step. */
export async function captureMeadowPreview(page) {
  await page.setViewportSize({ width: 1440, height: 960 });
  const report = await page.evaluate(async () => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { MeadowPlacementCache, meadowBiome, MEADOW_SPRITES, loadMeadowArt } = await import('/src/game/meadow-art.ts');
    const { worldRevisions } = await import('/src/game/world-revisions.ts');
    const { buildingWidth, buildingHeight, WATER } = await import('/src/game/types.ts');
    if (window.__game) window.__game.state.paused = true;
    const state = await createScenarioGame('musketry-deathmatch');
    state.paused = true;
    const time = state.time, world = state.world, width = world.width, height = world.height;
    await loadMeadowArt();
    const occupied = new Set();
    const buildings = new Float32Array(width * height), roads = new Float32Array(width * height), units = new Float32Array(width * height);
    for (const b of state.buildings) {
      if (b.hp <= 0) continue;
      for (let dy = 0; dy < buildingHeight(b); dy++) for (let dx = 0; dx < buildingWidth(b); dx++) {
        const x = Math.floor(b.x) + dx, y = Math.floor(b.y) + dy;
        if (x >= 0 && y >= 0 && x < width && y < height) occupied.add(y * width + x);
      }
      const index = Math.floor(b.y) * width + Math.floor(b.x);
      if (b.kind === 'road') roads[index]++;
      else if (b.kind !== 'camp' && b.kind !== 'palisade' && b.kind !== 'wall') buildings[index]++;
    }
    for (const f of state.fields ?? []) occupied.add(Math.floor(f.y) * width + Math.floor(f.x));
    for (const unit of state.units) if (unit.hp > 0 && !unit.inside && !unit.aboardRowboat && !unit.aboardRiverTrade) {
      const x = Math.floor(unit.x), y = Math.floor(unit.y);
      if (x >= 0 && y >= 0 && x < width && y < height) units[y * width + x]++;
    }
    const grassland = new Float32Array(width * height), plains = new Float32Array(width * height), plainsArea = new Float32Array(width * height), water = new Float32Array(width * height), relief = new Float32Array(width * height);
    const meadow = new MeadowPlacementCache(), geometry = worldRevisions(world).geometry;
    let grasslandTufts = 0, plainsTufts = 0, biomeLeaks = 0;
    for (let index = 0; index < world.tiles.length; index++) {
      const tile = world.tiles[index], x = index % width, y = Math.floor(index / width);
      water[index] = Number(WATER.has(tile.terrain) || !!tile.creek);
      relief[index] = Number(!!tile.relief);
      const tufts = meadow.get(world, x, y, geometry);
      for (const tuft of tufts) if (MEADOW_SPRITES[tuft.variant].biome !== tile.terrain) biomeLeaks++;
      if (occupied.has(index)) continue;
      plainsArea[index] = Number(meadowBiome(tile) === 'plains');
      if (tile.terrain === 'grassland') { grassland[index] = tufts.length; grasslandTufts += tufts.length; }
      else if (tile.terrain === 'plains') { plains[index] = tufts.length; plainsTufts += tufts.length; }
    }
    if (biomeLeaks) throw new Error('Meadow preview found a grass biome mismatch');
    const prefix = (source) => {
      const result = new Float64Array((width + 1) * (height + 1)), stride = width + 1;
      for (let y = 0; y < height; y++) {
        let row = 0;
        for (let x = 0; x < width; x++) { row += source[y * width + x]; result[(y + 1) * stride + x + 1] = result[y * stride + x + 1] + row; }
      }
      return result;
    };
    const fields = Object.fromEntries(Object.entries({ grassland, plains, plainsArea, buildings, roads, units, water, relief }).map(([name, values]) => [name, prefix(values)]));
    const sum = (data, x, y, w, h) => {
      const stride = width + 1, x2 = x + w, y2 = y + h;
      return data[y2 * stride + x2] - data[y * stride + x2] - data[y2 * stride + x] + data[y * stride + x];
    };
    const zoom = 1.35, viewWidth = Math.min(width, Math.floor(1440 / (32 * zoom))), viewHeight = Math.min(height, Math.floor(960 / (32 * zoom)));
    const choose = (biome) => {
      let best, scenic;
      for (let y = 1; y < height - viewHeight; y += 2) for (let x = 1; x < width - viewWidth; x += 2) {
        const counts = Object.fromEntries(Object.entries(fields).map(([name, values]) => [name, sum(values, x, y, viewWidth, viewHeight)]));
        const target = counts[biome], other = counts[biome === 'grassland' ? 'plains' : 'grassland'];
        if (biome === 'plains' && target === 0) continue;
        const city = Math.min(counts.buildings, 18), people = Math.min(counts.units, 10);
        const score = biome === 'plains'
          ? target * 5 + counts.plainsArea * 1.5 - counts.water * .8 - counts.relief * 5 - other * .25
            + Math.min(counts.buildings, 2) * 3 + Math.min(counts.units, 2) + Math.min(counts.roads, 10) * .25
          : target + city * 7 + people * 7 + Math.min(counts.roads, 45) * .5
            + Math.min(counts.water, 45) * .3 - counts.relief * 4 - other * .14;
        const candidate = { x: x + viewWidth / 2, y: y + viewHeight / 2, score, ...counts };
        if (!best || score > best.score) best = candidate;
        if (biome === 'grassland' && target >= 40 && counts.buildings >= 4 && counts.units >= 1 && counts.roads >= 6
          && (!scenic || score > scenic.score)) scenic = candidate;
      }
      best = scenic ?? best;
      if (!best || best[biome] === 0) throw new Error(`Meadow preview requires natural ${biome} openings`);
      return best;
    };
    const locations = { grassland: choose('grassland'), plains: choose('plains') };
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas><aside style="position:absolute;left:24px;top:20px;color:#ffedc3;font:30px \'Pixel Operator\';text-shadow:0 2px #151b16;pointer-events:none">Grassland</aside>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap); await renderer.initialize();
    setMapRevealed(state, true);
    renderer.follow = false; renderer.zoom = zoom;
    renderer.camera = { x: locations.grassland.x, y: locations.grassland.y };
    renderer.draw(state, 0);
    window.__meadowReview = { state, renderer, host, locations, time, zoom };
    return { scenario: state.world.scenario, worldSeed: state.world.seed, time, locations, grasslandTufts, plainsTufts, biomeLeaks };
  });
  await mkdir('output/startup', { recursive: true });
  await page.screenshot({ path: 'output/startup/meadow-grassland.png' });
  await page.evaluate(() => {
    const { state, renderer, host, locations } = window.__meadowReview;
    renderer.camera = { x: locations.plains.x, y: locations.plains.y };
    host.querySelector('aside').textContent = 'Plains';
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/meadow-plains.png' });
  await page.evaluate(() => {
    const { state, renderer, host, locations } = window.__meadowReview;
    renderer.camera = { x: locations.grassland.x, y: locations.grassland.y };
    renderer.zoom = 2.05;
    host.querySelector('aside').textContent = 'Grassland';
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/meadow-grassland-detail.png' });
  await page.evaluate(() => {
    const { state, renderer, host, locations } = window.__meadowReview;
    renderer.camera = { x: locations.plains.x, y: locations.plains.y };
    host.querySelector('aside').textContent = 'Plains';
    renderer.draw(state, 0);
  });
  await page.screenshot({ path: 'output/startup/meadow-plains-detail.png' });
  const frozen = await page.evaluate(() => {
    const { state, time, host } = window.__meadowReview;
    host.remove();
    return state.paused && state.time === time;
  });
  if (!frozen) throw new Error('Meadow previews must remain frozen');
  await writeFile('output/startup/meadow-preview.json', JSON.stringify({ ...report, frozen }, null, 2) + '\n');
  console.log(`Meadow preview: ${JSON.stringify({ ...report, frozen })}`);
}

/** Capture the native fertility patches in the frozen startup world. */
export async function captureFertilityPreview(page) {
  const viewport = page.viewportSize();
  const captureWidth = 1440, captureHeight = 960, zoom = 1.5;
  await page.setViewportSize({ width: captureWidth, height: captureHeight });
  const report = await page.evaluate(async ({ captureWidth, captureHeight, zoom }) => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { fertilityGrassFooting, fertilityGrassTerrain, soilFertility } = await import('/src/game/fertility.ts');
    const { fieldHarvestFood } = await import('/src/game/farms.ts');
    const { buildingWidth, buildingHeight, TILE_SIZE } = await import('/src/game/types.ts');
    const state = (window.__worldViewer ?? window.__game).state;
    state.paused = true;
    const { world, time } = state, { tiles, width, height } = world;
    const viewWidth = Math.min(width, Math.floor(captureWidth / (TILE_SIZE * zoom)));
    const viewHeight = Math.min(height, Math.floor(captureHeight / (TILE_SIZE * zoom)));

    const measureCoverage = (currentWorld) => {
      const counts = [0, 0, 0, 0], examples = new Map();
      let eligible = 0, outside = 0;
      for (const [cell, tile] of currentWorld.tiles.entries()) {
        const density = tile.fertilityGrass ?? 0;
        if (fertilityGrassTerrain(tile)) eligible++;
        else if (density) outside++;
        counts[density]++;
        if (density && !examples.has(density)) examples.set(density, cell);
      }
      return { eligible, selected: counts[1] + counts[2] + counts[3], counts, outside, examples };
    };
    const scenarioWorld = (await createScenarioGame('musketry-deathmatch')).world;
    const { examples, ...scenario } = measureCoverage(scenarioWorld);
    const { examples: _examples, ...generated } = measureCoverage(world);
    const { tiles: scenarioTiles, width: scenarioWidth, height: scenarioHeight } = scenarioWorld;
    let mirrored = 0, mirrorMismatches = 0;
    for (let y = 0; y < scenarioHeight; y++) for (let x = 0; x < Math.floor(scenarioWidth / 2); x++) {
      const west = scenarioTiles[y * scenarioWidth + x], east = scenarioTiles[y * scenarioWidth + scenarioWidth - 1 - x];
      if (!fertilityGrassTerrain(west) || west.terrain !== east.terrain) continue;
      mirrored++;
      if (west.fertilityGrass !== east.fertilityGrass) mirrorMismatches++;
    }
    const control = { ...scenarioWorld, tiles: scenarioTiles.slice() };
    const samples = [];
    for (const [density, cell] of examples) {
      control.tiles[cell] = { ...scenarioTiles[cell], fertilityGrass: undefined };
      const x = cell % scenarioWidth, y = Math.floor(cell / scenarioWidth);
      samples.push({ density, soilMultiplier: soilFertility(scenarioWorld, x, y) / soilFertility(control, x, y),
        harvestMultiplier: fieldHarvestFood(scenarioWorld, x, y) / fieldHarvestFood(control, x, y) });
    }
    const occupied = new Uint8Array(tiles.length), population = new Uint8Array(tiles.length);
    for (const building of state.buildings) {
      if (building.hp <= 0) continue;
      const startX = Math.floor(building.x), startY = Math.floor(building.y);
      for (let y = startY; y < startY + buildingHeight(building); y++) for (let x = startX; x < startX + buildingWidth(building); x++) {
        if (x >= 0 && y >= 0 && x < width && y < height) occupied[y * width + x] = building.kind === 'road' ? 1 : 2;
      }
    }
    for (const field of state.fields ?? []) occupied[Math.floor(field.y) * width + Math.floor(field.x)] = 3;
    for (const unit of state.units) if (unit.hp > 0 && !unit.inside) {
      const x = Math.floor(unit.x), y = Math.floor(unit.y);
      if (x >= 0 && y >= 0 && x < width && y < height) population[y * width + x] = 1;
    }

    const OPEN = 1, WOODED = 2, ROCKY = 4;
    const patchCover = new Uint8Array(tiles.length);
    for (const [cell, tile] of tiles.entries()) {
      if (occupied[cell] || !tile.fertilityGrass || !fertilityGrassFooting(tile)) continue;
      const wooded = tile.overlay === 'forest' || tile.overlay === 'jungle' || tile.palm;
      const rocky = tile.rockHost !== undefined;
      patchCover[cell] = wooded || rocky ? Number(!!wooded) * WOODED | Number(rocky) * ROCKY : OPEN;
    }

    // Summed-area counters keep the scenic camera search linear in map size.
    const stride = width + 1, size = stride * (height + 1);
    const gold = new Uint32Array(size), town = new Uint32Array(size), water = new Uint32Array(size), crops = new Uint32Array(size);
    const woods = new Uint32Array(size), rocks = new Uint32Array(size);
    for (let y = 0; y < height; y++) {
      let goldRow = 0, townRow = 0, waterRow = 0, cropRow = 0, woodsRow = 0, rockRow = 0;
      for (let x = 0; x < width; x++) {
        const cell = y * width + x, index = (y + 1) * stride + x + 1, tile = tiles[cell];
        const cover = patchCover[cell];
        if (cover === OPEN) goldRow += tile.fertilityGrass;
        else if (cover && (x > 0 && patchCover[cell - 1] === OPEN || x + 1 < width && patchCover[cell + 1] === OPEN
          || y > 0 && patchCover[cell - width] === OPEN || y + 1 < height && patchCover[cell + width] === OPEN)) {
          woodsRow += Number(!!(cover & WOODED));
          rockRow += Number(!!(cover & ROCKY));
        }
        townRow += (occupied[cell] === 1 ? 1 : occupied[cell] === 2 ? 3 : 0) + population[cell] * 3;
        waterRow += Number(tile.terrain === 'river' || tile.terrain === 'lake' || !!tile.creek);
        cropRow += Number(occupied[cell] === 3);
        gold[index] = goldRow + gold[index - stride];
        town[index] = townRow + town[index - stride];
        water[index] = waterRow + water[index - stride];
        crops[index] = cropRow + crops[index - stride];
        woods[index] = woodsRow + woods[index - stride];
        rocks[index] = rockRow + rocks[index - stride];
      }
    }
    const sum = (data, left, top, inset = 0) => {
      const span = viewWidth - 2 * inset;
      const origin = (top + inset) * stride + left + inset;
      const end = origin + (viewHeight - 2 * inset) * stride + span;
      return data[end] - data[origin + span] - data[end - span] + data[origin];
    };
    let focus;
    for (let y = 0; y <= height - viewHeight; y++) for (let x = 0; x <= width - viewWidth; x++) {
      const patch = sum(gold, x, y);
      if (!patch) continue;
      const wooded = sum(woods, x, y, 2), rocky = sum(rocks, x, y, 2);
      if (!wooded || !rocky) continue;
      const landmarks = sum(town, x, y), fresh = sum(water, x, y);
      const score = patch + Math.min(wooded, 12) * 5 + Math.min(rocky, 8) * 7
        + Math.min(landmarks, 50) * .55 + Math.min(fresh, 40) * .6 - sum(crops, x, y) * .5;
      if (!focus || score > focus.score) focus = { x: x + viewWidth / 2, y: y + viewHeight / 2, score, patch, landmarks, fresh, wooded, rocky };
    }
    if (!focus) throw new Error('The fertility preview needs fertile trees and rocks bordering open fertile soil');
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
    host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap);
    await renderer.initialize();
    setMapRevealed(state, true);
    renderer.follow = false;
    renderer.zoom = zoom;
    renderer.camera = { x: focus.x, y: focus.y };
    renderer.draw(state, 0);
    window.__fertilityPreview = { state, renderer, host, time };
    return { scenario: { id: scenarioWorld.scenario, ...scenario, mirrored, mirrorMismatches }, generated, samples, focus };
  }, { captureWidth, captureHeight, zoom });
  try {
    const { generated, scenario } = report;
    assert.equal(scenario.outside + generated.outside, 0, 'Fertility grass must be on grassland or plains');
    assert.equal(generated.selected, Math.round(generated.eligible * .15), 'Generated fertility grass must cover 15% of grassland and plains cells');
    assert.equal(scenario.selected, Math.round(scenario.eligible * .15 / 2) * 2, 'The symmetric scenario must use the closest pair count to 15% coverage');
    assert.ok(scenario.mirrored > 0 && scenario.mirrorMismatches === 0, 'Opposite sides of the scenario must share fertility densities');
    assert.equal(report.samples.length, 3, 'The scenario must include all fertility densities');
    for (const { density, soilMultiplier, harvestMultiplier } of report.samples) {
      assert.ok(Math.abs(soilMultiplier - (1 + density)) < 1e-9, `Incorrect soil fertility at density ${density}`);
      assert.ok(Math.abs(harvestMultiplier - soilMultiplier) < 1e-9, `Incorrect harvest yield at density ${density}`);
    }
    await mkdir('output/startup', { recursive: true });
    await page.screenshot({ path: 'output/startup/fertile-grassland.png' });
  } finally {
    const frozen = await page.evaluate(() => {
      const { state, renderer, host, time } = window.__fertilityPreview;
      renderer.destroy();
      host.remove();
      delete window.__fertilityPreview;
      return state.paused && state.time === time;
    });
    await page.setViewportSize(viewport);
    assert.ok(frozen, 'The fertility preview must remain frozen');
  }
  console.log(`Fertility preview: ${JSON.stringify(report)}`);
}
