import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const folder = 'scratch/2026-11-01-marsh-game';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
const errors = [], failedRequests = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('requestfailed', request => failedRequests.push(request.url()));
await page.addInitScript(() => { requestAnimationFrame = () => 0; });
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5197/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => ['ready', 'error'].includes(document.documentElement.dataset.assets), null, { polling: 50, timeout: 30000 });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.assets), 'ready', `Game assets failed: ${JSON.stringify({ errors, failedRequests })}`);
  const result = await page.evaluate(async () => {
    const [{ Renderer }, { generateWorld }, { createGame }, vegetation, { markWorldChanged }, { rasterTerrain }, { punyWorldPixels, punyDesertLedgePixels }, { WATER, unitMaxHp }] = await Promise.all([
      import('/src/game/renderer.ts'), import('/src/world/generator.ts'), import('/src/game/simulation.ts'), import('/src/game/vegetation-art.ts'),
      import('/src/game/world-revisions.ts'), import('/src/game/terrain.ts'), import('/src/game/puny-world.ts'), import('/src/game/types.ts'),
    ]);
    const checks = [], pictures = {};
    const check = (name, pass, detail) => { checks.push({ name, pass, detail }); if (!pass) throw new Error(`${name}: ${JSON.stringify(detail)}`); };
    const target = document.createElement('canvas'), minimap = document.createElement('canvas');
    target.style.cssText = 'width:1200px;height:800px;display:block'; minimap.width = minimap.height = 160;
    document.body.replaceChildren(target, minimap);
    const renderer = new Renderer(target, minimap); await renderer.initialize();
    renderer.follow = false; renderer.zoom = 1;
    // Fully explored test maps: omit the presentation fog only for inspection.
    // Anchor eligibility still runs through the actual updateFog/pointExplored path.
    const drawFog = renderer.gpu.drawFog.bind(renderer.gpu);
    renderer.gpu.drawFog = () => {};
    const frame = state => { renderer.draw(state, 0); return renderer.snapshot(); };
    const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const difference = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
    const explore = world => ({ width: world.width, height: world.height, seed: world.seed, explored: Array(world.tiles.length).fill(1), buildings: [], fields: [] });
    const world = generateWorld('ALDER-DELTA', undefined, undefined, { landformFamily: 'river-basin' });
    const game = createGame(world); game.fog = explore(world); game.selected = null; game.buildMode = null; game.paused = true;
    const worker = structuredClone(game.units.find(unit => unit.kind === 'worker') ?? game.units.find(unit => unit.kind === 'leader'));
    Object.assign(worker, { id: 999999, faction: 0, kind: 'worker', moving: false, inside: undefined, cargo: 0, facing: 0, attackTime: -100, damageFlashAt: undefined });
    worker.hp = unitMaxHp(worker);
    const delta = [...world.riverDeltas].sort((a, b) => b.marshCells.length - a.marshCells.length)[0];
    const marshCells = world.tiles.flatMap((tile, cell) => tile.marsh ? [cell] : []);
    check('new generated game contains coastal marsh deltas', world.riverDeltas.length > 0 && marshCells.length > 100, { deltas: world.riverDeltas.length, marsh: marshCells.length });
    check('all planted marsh roots are on dry ground', marshCells.every(cell => !WATER.has(world.tiles[cell].terrain)));
    const assets = await Promise.all(['2A', '2B', '2C', '2D'].map(async id => {
      const image = new Image(); image.src = `/assets/vegetation/marsh/${id}.png`; await image.decode(); return { id, width: image.width, height: image.height };
    }));
    check('four approved full-detail plant assets load in the game', assets.every(asset => asset.width === 32 && asset.height === 48), assets);
    const sample = world.tiles[marshCells[0]], bounds = vegetation.vegetationArtBounds(sample, 32);
    check('plant dimensions retain approved width height and footing', bounds.width === 64 && Math.abs(bounds.height - 78.4) < 1e-8 && Math.abs(bounds.y + bounds.height - 30) < 1e-8, bounds);
    const variants = [0, 1, 2, 3].map(index => vegetation.vegetationVariant({ ...sample, variation: index / 0x1000000 }));
    check('all four variants are distinct shared sources', new Set(variants.map(sprite => `${sprite.sheet}:${sprite.x}:${sprite.y}`)).size === 4, variants);
    renderer.camera = { x: delta.bounds.x + delta.bounds.width / 2, y: delta.bounds.y + delta.bounds.height / 2 };
    const planted = frame(game); pictures['delta-game-normal'] = planted.toDataURL();
    const plantedPixels = pixels(planted);
    frame(game); frame(game);
    check('steady frames reuse cached plant textures', renderer.renderStats.rasterized === 0 && renderer.renderStats.textureUploads === 0, renderer.renderStats);
    const terrain = rasterTerrain(world, undefined, punyWorldPixels(), punyDesertLedgePixels());
    for (const cell of marshCells) world.tiles[cell].marsh = false;
    markWorldChanged(world, 'appearance');
    const bare = frame(game); pictures['delta-game-lifted'] = bare.toDataURL(); const barePixels = pixels(bare);
    const ox = 600 - renderer.camera.x * 32, oy = 400 - renderer.camera.y * 32; let visibleWater = 0, coveredWater = 0;
    for (let y = 0; y < 800; y++) for (let x = 0; x < 1200; x++) {
      const tx = Math.floor((x - ox) / 2), ty = Math.floor((y - oy) / 2), p = (y * 1200 + x) * 4;
      if (tx < 0 || ty < 0 || tx >= terrain.width || ty >= terrain.height || !terrain.water[ty * terrain.width + tx]) continue;
      visibleWater++;
      if (plantedPixels[p] !== barePixels[p] || plantedPixels[p + 1] !== barePixels[p + 1] || plantedPixels[p + 2] !== barePixels[p + 2]) coveredWater++;
    }
    check('marsh canopy visibly overlaps the water', visibleWater > 1000 && coveredWater > 1000, { visibleWater, coveredWater, fraction: coveredWater / visibleWater });
    for (const cell of marshCells) world.tiles[cell].marsh = true;
    markWorldChanged(world, 'appearance'); renderer.zoom = 2;
    pictures['delta-game-close'] = frame(game).toDataURL();

    // A normal sight-limited frame uses the game's real fog renderer unchanged.
    const focus = delta.marshCells.reduce((best, cell) => {
      const distance = Math.hypot(cell % world.width - renderer.camera.x, Math.floor(cell / world.width) - renderer.camera.y);
      return distance < best.distance ? { cell, distance } : best;
    }, { cell: delta.marshCells[0], distance: Infinity }).cell;
    const leader = game.units.find(unit => unit.kind === 'leader' && unit.faction === 0);
    leader.x = focus % world.width + .5; leader.y = Math.floor(focus / world.width) + .5;
    renderer.camera = { x: leader.x, y: leader.y }; renderer.zoom = 1;
    game.fog = undefined; renderer.gpu.drawFog = drawFog; frame(game); game.time += 1;
    const fogFrame = frame(game); pictures['delta-game-with-fog'] = fogFrame.toDataURL();
    const fogPixels = pixels(fogFrame); let dark = 0, colored = 0;
    for (let i = 0; i < fogPixels.length; i += 4) {
      if (fogPixels[i] + fogPixels[i + 1] + fogPixels[i + 2] < 15) dark++;
      else colored++;
    }
    check('normal gameplay fog hides unknown terrain around the marsh', dark > 10000 && colored > 10000, { dark, colored });
    renderer.gpu.drawFog = () => {};

    // Controlled real-Pixi compositing fixture isolates the approved sprite.
    const width = 40, height = 30, tile = { terrain: 'grassland', overlay: 'none', elevation: .1, moisture: .8, food: 3, production: 1, gold: 0, variation: 0 };
    const fixtureWorld = { width, height, seed: 'MARSH-RENDER-QA', source: 'render fixture', spawns: [], tiles: Array.from({ length: width * height }, () => ({ ...tile })) };
    const fixture = { ...game, world: fixtureWorld, units: [], buildings: [], fields: [], villages: [], treasures: [], treeStumps: [], bloodEffects: [], unitDeaths: [], particles: [], projectiles: [], selected: null,
      fog: explore(fixtureWorld), time: 0 };
    renderer.zoom = 1; renderer.camera = { x: 10.5, y: 10 };
    const plantCell = 10 * width + 10, plant = fixtureWorld.tiles[plantCell]; plant.marsh = true;
    const depth = [];
    for (let variant = 0; variant < 4; variant++) {
      plant.variation = variant / 0x1000000;
      fixture.units = []; const background = pixels(frame(fixture));
      fixture.units = [{ ...worker, x: 10.5, y: 10.85 }]; const behind = pixels(frame(fixture));
      fixture.units = [{ ...worker, x: 10.5, y: 11.05 }]; const front = pixels(frame(fixture));
      depth.push({ variant, behindPixels: difference(background, behind), frontPixels: difference(background, front) });
    }
    check('all variants conceal the worker behind their footing', depth.every(value => value.behindPixels <= 3), depth);
    check('workers in front of the footing remain visible', depth.every(value => value.frontPixels > 60), depth);
    pictures['worker-in-front'] = frame(fixture).toDataURL();
    fixture.units = [{ ...worker, x: 10.5, y: 10.85 }]; pictures['worker-behind'] = frame(fixture).toDataURL();
    fixture.units = [];

    // An unexplored footing must not leak its crown into explored neighbors,
    // even with presentation fog omitted so the eligibility check is exposed.
    fixture.fog = explore(fixtureWorld); fixture.fog.explored[plantCell] = 0;
    const unknownWithPlant = pixels(frame(fixture)); plant.marsh = false;
    const unknownBare = pixels(frame(fixture));
    check('unexplored anchors never reveal a marsh crown', difference(unknownWithPlant, unknownBare) === 0);
    plant.marsh = true; fixture.fog = explore(fixtureWorld);

    // The plant's footing is below the viewport while its crown remains visible.
    renderer.camera = { x: 10.5, y: 10.9375 - 800 / 64 - 1 };
    const offscreenPlant = pixels(frame(fixture)); plant.marsh = false;
    const offscreenBare = pixels(frame(fixture));
    check('offscreen footings retain their visible upper crown', difference(offscreenPlant, offscreenBare) > 100, { changedPixels: difference(offscreenPlant, offscreenBare) });
    plant.marsh = true; pictures['viewport-edge-canopy'] = frame(fixture).toDataURL();
    renderer.destroy();
    return { checks, pictures, generated: { seed: world.seed, deltas: world.riverDeltas.length, marsh: marshCells.length }, depth };
  });
  for (const [name, uri] of Object.entries(result.pictures)) await writeFile(`${folder}/${name}.png`, Buffer.from(uri.split(',')[1], 'base64'));
  delete result.pictures;
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
  await writeFile(`${folder}/browser-checks.json`, JSON.stringify({ ...result, errors, failedRequests }, null, 2));
  console.log(JSON.stringify({ passed: result.checks.length, generated: result.generated, depth: result.depth }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ errors, failedRequests }, null, 2));
  throw error;
} finally { await browser.close(); }
