import { mkdir, writeFile } from 'node:fs/promises';

/** Production renderer on a detached, frozen baked world. No input or sim step. */
export async function captureMeadowPreview(page) {
  await page.setViewportSize({ width: 1440, height: 960 });
  const report = await page.evaluate(async () => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { setMapRevealed } = await import('/src/game/fog.ts');
    const { meadowTufts, MEADOW_SPRITES, loadMeadowArt } = await import('/src/game/meadow-art.ts');
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
    const grassland = new Float32Array(width * height), plains = new Float32Array(width * height), water = new Float32Array(width * height), relief = new Float32Array(width * height);
    let grasslandTufts = 0, plainsTufts = 0, biomeLeaks = 0;
    for (let index = 0; index < world.tiles.length; index++) {
      const tile = world.tiles[index], x = index % width, y = Math.floor(index / width);
      water[index] = Number(WATER.has(tile.terrain) || !!tile.creek);
      relief[index] = Number(!!tile.relief);
      const tufts = meadowTufts(tile, x, y);
      for (const tuft of tufts) if (MEADOW_SPRITES[tuft.variant].biome !== tile.terrain) biomeLeaks++;
      if (occupied.has(index)) continue;
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
    const fields = Object.fromEntries(Object.entries({ grassland, plains, buildings, roads, units, water, relief }).map(([name, values]) => [name, prefix(values)]));
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
        const city = Math.min(counts.buildings, 18), people = Math.min(counts.units, 10);
        const score = target + city * (biome === 'plains' ? 4 : 7) + people * 7 + Math.min(counts.roads, 45) * .5
          + Math.min(counts.water, 45) * .3 - counts.relief * 4 - other * .14;
        const candidate = { x: x + viewWidth / 2, y: y + viewHeight / 2, score, ...counts };
        if (!best || score > best.score) best = candidate;
        if (target >= (biome === 'grassland' ? 40 : 12) && counts.buildings >= 4 && counts.units >= 1 && counts.roads >= 6
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
