import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { measureRiverIslands } from './swamp-valley-metrics.mjs';

const folder = 'scratch/2026-11-04-oxbow-tight-loops';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const checks = [], errors = [], network = [], audits = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (!/^(file|data|blob):/.test(request.url())) network.push(request.url()); });
const check = (name, pass, detail) => {
  checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  assert.ok(pass, `${name}: ${JSON.stringify(detail)}`);
};
const water = new Set(['ocean', 'coast', 'river', 'lake']);
const geometry = scene => JSON.stringify(scene.world.tiles.map(tile => [tile.terrain, tile.marsh, tile.ridge, tile.overlay]));

function connectedComponents(world, predicate) {
  const unseen = new Set(world.tiles.flatMap((tile, cell) => predicate(tile, cell) ? [cell] : [])), components = [];
  while (unseen.size) {
    const queue = [unseen.values().next().value]; unseen.delete(queue[0]);
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i], x = cell % world.width, y = Math.floor(cell / world.width);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
        if (nx >= 0 && ny >= 0 && nx < world.width && ny < world.height && unseen.delete(next)) queue.push(next);
      }
    }
    components.push(queue);
  }
  return components.sort((a, b) => b.length - a.length);
}

function audit(scene) {
  const { world, variant, seed, metrics } = scene, issues = [];
  const waterComponents = connectedComponents(world, tile => water.has(tile.terrain));
  const riverCells = world.tiles.flatMap((tile, cell) => tile.terrain === 'river' || tile.channel ? [cell] : []);
  const mainWater = waterComponents.find(component => component.some(cell => riverCells.includes(cell)));
  const mainSet = new Set(mainWater);
  if (!riverCells.length || riverCells.some(cell => !mainSet.has(cell))) issues.push('River footprint is disconnected');
  const wet = (x, y) => x >= 0 && y >= 0 && x < world.width && y < world.height && water.has(world.tiles[y * world.width + x].terrain);
  const interiorRiver = riverCells.filter(cell => cell % world.width > 0 && cell % world.width < world.width - 1 && Math.floor(cell / world.width) > 0 && Math.floor(cell / world.width) < world.height - 1);
  const oneTileCells = interiorRiver.filter(cell => {
    const x = cell % world.width, y = Math.floor(cell / world.width);
    return (!wet(x - 1, y) && !wet(x + 1, y)) || (!wet(x, y - 1) && !wet(x, y + 1));
  });
  const oneTileShare = oneTileCells.length / interiorRiver.length;
  if (oneTileShare < .25) issues.push('Fewer than 25% of actual river cells have one-tile width between opposite dry banks');
  const riverSet = new Set(riverCells);
  const unthickenedCells = riverCells.filter(cell => {
    const x = cell % world.width, y = Math.floor(cell / world.width);
    for (const ox of [-1, 0]) for (const oy of [-1, 0]) {
      const left = x + ox, top = y + oy;
      if (left >= 0 && top >= 0 && left + 1 < world.width && top + 1 < world.height
        && [top * world.width + left, top * world.width + left + 1, (top + 1) * world.width + left, (top + 1) * world.width + left + 1].every(next => riverSet.has(next))) return false;
    }
    return true;
  });
  const unthickenedShare = unthickenedCells.length / riverCells.length;
  if (unthickenedShare < .65) issues.push('Fewer than 65% of actual river cells form one-cell paths outside filled2×2 water blocks');
  const declaredThin = new Set((scene.thinChannelCells ?? []).map(p => p.y * world.width + p.x));
  if (declaredThin.size !== unthickenedCells.length || unthickenedCells.some(cell => !declaredThin.has(cell))) issues.push('Reported thin channel cells differ from actual terrain widths');
  // A dry component surrounded by river demonstrates a real split-and-rejoin
  // route, independent of branch metadata or the continuous drawing curves.
  const islands = connectedComponents(world, tile => tile.terrain !== 'river')
    .filter(component => component.length >= 4 && component.every(cell => cell % world.width > 0 && cell % world.width < world.width - 1 && Math.floor(cell / world.width) > 0 && Math.floor(cell / world.width) < world.height - 1));
  if (!islands.length) issues.push('No actual split-and-rejoin water route encloses a dry island');
  const wetPlants = world.tiles.flatMap((tile, cell) => tile.marsh ? [cell] : []);
  if (!wetPlants.length) issues.push('No tall wetland grass');
  for (const cell of wetPlants) {
    const tile = world.tiles[cell], x = cell % world.width, y = Math.floor(cell / world.width);
    if (water.has(tile.terrain) || tile.stair) issues.push(`Grass root on water or stairs: ${cell}`);
    if (tile.ridge) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy, next = nx >= 0 && ny >= 0 && nx < world.width && ny < world.height ? world.tiles[ny * world.width + nx] : undefined;
      if (next?.ridge !== tile.ridge || (next?.ridgeTier ?? 1) < (tile.ridgeTier ?? 1)) issues.push(`Grass root on a ledge: ${cell}`);
    }
  }
  const isolatedPools = waterComponents.filter(component => component !== mainWater);
  if (isolatedPools.some(component => component.length > world.tiles.length * .05)) issues.push('An off-channel pond exceeds 5% of the scene');
  const { mainChannel = [], ponds = [] } = scene;
  const length = mainChannel.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - mainChannel[i].x, p.y - mainChannel[i].y), 0);
  const start = mainChannel[0], end = mainChannel.at(-1);
  const sinuosity = start && end ? length / Math.hypot(end.x - start.x, end.y - start.y) : 0;
  if (sinuosity < 1.3 || Math.abs(sinuosity - metrics.mainSinuosity) > 1e-8) issues.push('Main river lacks measured sinuosity or reports the wrong value');
  if (ponds.length !== metrics.pondCount || ponds.length < 1 || ponds.length !== isolatedPools.length) issues.push('Ponds do not match their independent water components');
  for (const pond of ponds) {
    const cells = new Set(pond.map(p => p.y * world.width + p.x));
    if (!isolatedPools.some(component => component.length === cells.size && component.every(cell => cells.has(cell)))) issues.push('Pond is disconnected or joined to the river');
    if (pond.length > 16 || pond.some(p => world.tiles[p.y * world.width + p.x]?.terrain !== 'lake')) issues.push('Pond is too large or has a dry interior cell');
  }
  const oxbows = scene.oxbows ?? [];
  if (oxbows.length < 2 || oxbows.length !== metrics.oxbowCount) issues.push('Missing multiple abandoned oxbows');
  const oxbowAudits = oxbows.map(oxbow => {
    const cells = new Set(oxbow.map(p => p.y * world.width + p.x));
    const neighbors = p => [[p.x - 1, p.y], [p.x + 1, p.y], [p.x, p.y - 1], [p.x, p.y + 1]].filter(([x, y]) => cells.has(y * world.width + x)).length;
    const ends = oxbow.filter(p => neighbors(p) === 1), noJunction = oxbow.every(p => neighbors(p) <= 2);
    const curvature = ends.length === 2 ? (oxbow.length - 1) / Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y) : 0;
    if (!noJunction || curvature < 1.6 || oxbow.some(p => world.tiles[p.y * world.width + p.x].lakeShape !== 'snaky')) issues.push('An oxbow is not a narrow curved cut-off channel');
    return { cells: oxbow.length, endpoints: ends.length, curvature };
  });
  const routes = scene.channelPaths ?? [], priorRouteCells = new Set(), routeAudits = [];
  if (routes.length < 3 || routes.length - 1 !== metrics.branchCount) issues.push('Missing multiple connected river routes');
  for (const [i, route] of routes.entries()) {
    const keys = route.map(p => p.y * world.width + p.x), newCells = new Set(keys.filter(cell => !priorRouteCells.has(cell)));
    const touchesPrior = p => !!p && [[p.x, p.y], [p.x - 1, p.y], [p.x + 1, p.y], [p.x, p.y - 1], [p.x, p.y + 1]].some(([x, y]) => priorRouteCells.has(y * world.width + x));
    const joinedEnds = !i || touchesPrior(route[0]) && touchesPrior(route.at(-1));
    if (keys.some(cell => !riverSet.has(cell)) || route.some((p, j) => j && Math.abs(p.x - route[j - 1].x) + Math.abs(p.y - route[j - 1].y) > 1)
      || i && (!joinedEnds || newCells.size < 5)) issues.push(`River route ${i} is not a distinct connected path`);
    routeAudits.push({ cells: route.length, newCells: newCells.size, joinedEnds });
    for (const cell of keys) priorRouteCells.add(cell);
  }
  const windows = [];
  for (let y = 0; y <= world.height - 6; y++) for (let x = 0; x <= world.width - 6; x++) {
    const tiles = [];
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) {
      const tile = world.tiles[(y + dy) * world.width + x + dx];
      if (!water.has(tile.terrain) && !tile.ridge && !tile.stair) tiles.push(tile);
    }
    if (tiles.length < 24) continue;
    windows.push({ x, y, dry: tiles.length, reeds: tiles.filter(tile => tile.marsh).length / tiles.length,
      vegetation: tiles.filter(tile => tile.marsh || tile.overlay === 'forest' || tile.overlay === 'jungle').length / tiles.length });
  }
  const denseWindow = windows.toSorted((a, b) => b.reeds - a.reeds)[0], openWindow = windows.toSorted((a, b) => a.vegetation - b.vegetation)[0];
  if (!denseWindow || denseWindow.reeds < .55 || !openWindow || openWindow.vegetation > .15) issues.push('Missing broad dense reeds or genuinely open meadow');
  const grassScales = wetPlants.map(cell => scene.grassScales?.[cell]);
  const shortGrass = grassScales.filter(scale => scale < .9).length, tallGrass = grassScales.filter(scale => scale > 1).length;
  if (grassScales.some(scale => !Number.isFinite(scale) || scale <= 0) || shortGrass < 5 || tallGrass < 5) issues.push('Missing meaningful local short and tall grass zones');
  return { id: variant.id, seed, valid: !issues.length, issues, metrics, sinuosity, oneTileCells: oneTileCells.length, oneTileShare,
    unthickenedShare, oxbowAudits, routeAudits,
    islandAreas: islands.map(island => island.length), islandMeasurements: measureRiverIslands(world), denseWindow, openWindow, grassHeightRange: [Math.min(...grassScales), Math.max(...grassScales)], shortGrass, tallGrass, pondSizes: ponds.map(pond => pond.length),
    waterComponents: waterComponents.map(component => component.length), riverCells: riverCells.length, wetPlants: wetPlants.length };
}

const sceneData = () => page.evaluate(() => [...window.__swampValleys.scenes.values()]);
const image = () => page.locator('#landscape').evaluate(canvas => canvas.toDataURL());
async function saveCanvas(file) { await writeFile(`${folder}/${file}`, Buffer.from((await image()).split(',')[1], 'base64')); }
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
  await page.goto(pathToFileURL(resolve('output/swamp-river-valley-designs.html')).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  const initial = await sceneData();
  check('four distinct valley designs are available', initial.length === 4 && new Set(initial.map(scene => scene.variant.id)).size === 4 && new Set(initial.map(geometry)).size === 4);
  const baseline = JSON.parse(await readFile(`${folder}/baseline-1A.json`, 'utf8'));
  const tightScene = initial.find(scene => scene.variant.id === '1A'), tight = measureRiverIslands(tightScene.world);
  const comparison = { before: baseline, after: tight, largestIslandReduction: 1 - tight.largestIslandArea / baseline.largestIslandArea,
    maximumInteriorDistanceReduction: 1 - tight.maximumInteriorDistance / baseline.maximumInteriorDistance };
  await writeFile(`${folder}/island-comparison.json`, JSON.stringify(comparison, null, 2));
  check('tighter loops preserve the map size and actual 32px tile scale', tightScene.world.width === baseline.width && tightScene.world.height === baseline.height
    && await page.locator('#landscape').evaluate(canvas => canvas.width === 48 * 32 && canvas.height === 32 * 32));
  check('Oxbow fen islands are genuinely narrower and smaller', comparison.largestIslandReduction >= .3 && comparison.maximumInteriorDistanceReduction >= .25, comparison);
  const frozen = await import(pathToFileURL(resolve(`${folder}/baseline-model.mjs`)).href);
  for (const scene of initial.filter(scene => scene.variant.id !== '1A')) {
    const before = frozen.generateValley(scene.variant.id, scene.seed);
    check(`${scene.variant.id}: the other valley remains unchanged`, JSON.stringify(scene.world.tiles) === JSON.stringify(before.world.tiles)
      && JSON.stringify(scene.channelPaths) === JSON.stringify(before.channelPaths) && JSON.stringify(scene.ponds) === JSON.stringify(before.ponds));
  }
  const sources = JSON.parse(await readFile(`${folder}/asset-sources.json`, 'utf8'));
  const embedded = await page.evaluate(() => window.SWAMP_VALLEY_ASSETS);
  for (const [id, path] of Object.entries(sources.files)) check(`${id}: embedded art matches the existing source`, Buffer.from(embedded[id].split(',')[1], 'base64').equals(await readFile(path)));
  check('Pixel Operator is embedded and loaded', await page.evaluate(() => document.fonts.check('19px PixelOperator') && getComputedStyle(document.body).fontFamily.includes('PixelOperator')));
  const views = [];
  for (const scene of initial) {
    const result = audit(scene); audits.push(result); check(`${scene.variant.id}: river, ponds, and grass roots respect terrain`, result.valid, result);
    await page.locator(`.card[data-id="${scene.variant.id}"]`).click();
    check(`${scene.variant.id}: card selects its scene`, await page.locator('#landscape').getAttribute('data-variant') === scene.variant.id);
    views.push(await image()); await saveCanvas(`valley-${scene.variant.id}.png`);
    await page.screenshot({ path: `${folder}/review-${scene.variant.id}-desktop.png`, fullPage: true });
    await page.locator('#plants').click();
    check(`${scene.variant.id}: lifting tall grass exposes different ground`, await image() !== views.at(-1) && await page.locator('#plants').getAttribute('aria-pressed') === 'true');
    await saveCanvas(`valley-${scene.variant.id}-ground.png`);
    await page.locator('#plants').click();
    check(`${scene.variant.id}: restoring grass reproduces its original image`, await image() === views.at(-1));
  }
  check('all four default rendered landscapes differ', new Set(views).size === 4);
  const first = initial[0];
  await page.locator(`.card[data-id="${first.variant.id}"]`).click();
  for (const [id, values] of [['height', ['0.85', '1.15']], ['density', ['0.7', '1.25']]]) {
    const before = await image();
    for (const value of values) {
      await page.locator(`#${id}`).selectOption(value);
      check(`${id} ${value}: control redraws vegetation`, await image() !== before);
    }
    await page.locator(`#${id}`).selectOption('1');
    check(`${id}: resetting restores the original scene`, await image() === before);
    check(`${id}: presentation controls preserve geography`, geometry((await sceneData()).find(scene => scene.variant.id === first.variant.id)) === geometry(first));
  }
  await page.locator('#zoom').selectOption('1'); const nativeWidth = await page.locator('#landscape').evaluate(canvas => canvas.getBoundingClientRect().width);
  await page.locator('#zoom').selectOption('2'); const gameWidth = await page.locator('#landscape').evaluate(canvas => canvas.getBoundingClientRect().width);
  check('native and game scale differ by exactly 2x', Math.abs(gameWidth - nativeWidth * 2) < 1, { nativeWidth, gameWidth });
  await page.locator('#zoom').selectOption('fit');
  await page.locator('#regenerate').click();
  const regenerated = (await sceneData()).find(scene => scene.variant.id === first.variant.id);
  check('another layout advances the seed and changes actual geography', regenerated.seed === first.seed + 1 && geometry(regenerated) !== geometry(first));
  const revisedAudit = audit(regenerated); audits.push(revisedAudit); check('the regenerated valley preserves valid terrain', revisedAudit.valid, revisedAudit);
  const deterministic = await page.evaluate(({ id, seed }) => window.__swampValleys.generateValley(id, seed), { id: first.variant.id, seed: first.seed });
  check('the same seed reconstructs identical geography', geometry(deterministic) === geometry(first));
  const downloadEvent = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloadEvent;
  const chunks = [], stream = await download.createReadStream(); for await (const chunk of stream) chunks.push(chunk); const png = Buffer.concat(chunks);
  const size = await page.locator('#landscape').evaluate(canvas => [canvas.width, canvas.height]);
  check('PNG export contains the complete native scene', png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.readUInt32BE(16) === size[0] && png.readUInt32BE(20) === size[1], size);
  await writeFile(`${folder}/downloaded-scene.png`, png);
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.ready === 'true'); await page.evaluate(() => document.fonts.ready);
  check('desktop layout has no horizontal page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${folder}/review-desktop.png`, fullPage: true });
  await page.locator('#gallery').screenshot({ path: `${folder}/valley-overview.png` });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await settle();
    check(`${width}px mobile layout has no horizontal page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check(`${width}px fit view shows the full valley width`, await page.locator('#landscape').evaluate(canvas => canvas.getBoundingClientRect().width <= canvas.parentElement.clientWidth + 1));
    await page.screenshot({ path: `${folder}/review-mobile-${width}.png`, fullPage: true });
  }
  check('the standalone file performs no external requests', network.length === 0, network);
  check('the browser reports no runtime errors', errors.length === 0, errors);
  const comparisonPage = await browser.newPage({ viewport: { width: 1600, height: 720 }, deviceScaleFactor: 1 });
  const beforeImage = `data:image/png;base64,${(await readFile(`${folder}/valley-1A-before.png`)).toString('base64')}`;
  const afterImage = `data:image/png;base64,${(await readFile(`${folder}/valley-1A.png`)).toString('base64')}`;
  const font = `data:font/ttf;base64,${(await readFile('public/assets/fonts/pixel-operator/PixelOperator.ttf')).toString('base64')}`;
  await comparisonPage.setContent(`<html><style>@font-face{font-family:PixelOperator;src:url(${font})}*{box-sizing:border-box}body{margin:0;padding:24px;background:#111e1a;color:#e4e6d0;font:22px PixelOperator,monospace}h1{font-size:38px;font-weight:400;margin:0 0 6px}p{color:#acbba0;margin:0 0 18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:#1b2a22;border:1px solid #617354;padding:12px}h2{font-size:27px;font-weight:400;margin:0 0 5px}article p{font-size:20px;margin:0 0 10px}img{display:block;width:100%;height:auto;image-rendering:pixelated}</style><h1>Oxbow fen · tighter loops</h1><p>Same 48×32 tile landscape and image scale · actual river geometry changed</p><div class="grid"><article><h2>Previous</h2><p>Largest island ${baseline.largestIslandArea} tiles · deepest interior ${baseline.maximumInteriorDistance.toFixed(1)} tiles from river</p><img src="${beforeImage}"></article><article><h2>Revised</h2><p>Largest island ${tight.largestIslandArea} tiles · deepest interior ${tight.maximumInteriorDistance.toFixed(1)} tiles from river</p><img src="${afterImage}"></article></div></html>`);
  await comparisonPage.evaluate(() => document.fonts.ready);
  await comparisonPage.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await comparisonPage.screenshot({ path: `${folder}/oxbow-before-after.png`, fullPage: true });
  await comparisonPage.close();
} finally {
  await writeFile(`${folder}/independent-audit.json`, JSON.stringify(audits, null, 2));
  await writeFile(`${folder}/browser-checks.json`, JSON.stringify({ checks, errors, network }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, passed: checks.filter(item => item.pass).length, errors, network }, null, 2));
  await browser.close();
}
