import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const folder = 'scratch/2026-11-01-marsh-birds';
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
  assert.equal(await page.evaluate(() => document.documentElement.dataset.assets), 'ready', `Assets failed: ${JSON.stringify({ errors, failedRequests })}`);
  const result = await page.evaluate(async () => {
    const [art, { Renderer }, { generateWorld }, simulation, hunting, birds, { WATER, tileAt }] = await Promise.all([
      import('/src/game/wildlife-art.ts'), import('/src/game/renderer.ts'), import('/src/world/generator.ts'), import('/src/game/simulation.ts'),
      import('/src/game/hunting.ts'), import('/src/game/marsh-birds.ts'), import('/src/game/types.ts'),
    ]);
    const checks = [], pictures = {};
    const check = (name, pass, detail) => { checks.push({ name, pass, detail }); if (!pass) throw new Error(`${name}: ${JSON.stringify(detail)}`); };
    const imagePixels = source => {
      const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
      canvas.getContext('2d').drawImage(source, 0, 0);
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    };
    await art.loadWildlifeArt();
    const original = new Image(); original.src = '/assets/miniworld/Chicken.png'; await original.decode();
    const source = imagePixels(original), birdSheet = art.wildlifeImage('marshBird'), changed = imagePixels(birdSheet);
    let red = 0, recolored = 0, changedOthers = 0, alphaChanges = 0;
    for (let i = 0; i < source.length; i += 4) {
      const match = art.MARSH_BIRD_PALETTE.find(({ from }) => source[i] === from[0] && source[i + 1] === from[1] && source[i + 2] === from[2]);
      if (match) { red++; if (changed[i] === match.to[0] && changed[i + 1] === match.to[1] && changed[i + 2] === match.to[2]) recolored++; }
      else if (source[i] !== changed[i] || source[i + 1] !== changed[i + 1] || source[i + 2] !== changed[i + 2]) changedOthers++;
      if (source[i + 3] !== changed[i + 3]) alphaChanges++;
    }
    check('exactly the two red shades change; other pixels and alpha are preserved', red === 56 && recolored === red && changedOthers === 0 && alphaChanges === 0, { red, recolored, changedOthers, alphaChanges });
    check('bird sheet retains all native 16px animation cells', birdSheet.width === 64 && birdSheet.height === 64);
    check('bird selection portrait uses recolored sheet', art.birdIconUrl().startsWith('data:image/png;base64,'));
    const comparison = document.createElement('canvas'); comparison.width = 576; comparison.height = 320;
    const cc = comparison.getContext('2d'); cc.fillStyle = '#293b2d'; cc.fillRect(0, 0, 576, 320); cc.imageSmoothingEnabled = false;
    cc.fillStyle = '#e7e7ce'; cc.font = '16px monospace'; cc.fillText('Original chicken', 16, 26); cc.fillText('Marsh bird', 304, 26);
    cc.drawImage(original, 16, 48, 256, 256); cc.drawImage(birdSheet, 304, 48, 256, 256); pictures['bird-palette'] = comparison.toDataURL();

    const world = generateWorld('ALDER-DELTA', undefined, undefined, { landformFamily: 'river-basin' });
    const game = simulation.createGame(world), flock = () => game.units.filter(unit => unit.kind === 'marshBird' && unit.hp > 0);
    const beforeUpdate = flock().length;
    simulation.updateGame(game, .5, { up: false, down: false, left: false, right: false });
    check('full simulation retains and updates marsh-bird units', beforeUpdate > 0 && flock().length === beforeUpdate, { before: beforeUpdate, after: flock().length });
    const initialBirds = flock(), herdIds = new Set(initialBirds.map(unit => unit.herdId));
    check('new game automatically populates coastal marsh with several flocks', initialBirds.length >= 8 && herdIds.size >= 2, { birds: initialBirds.length, flocks: herdIds.size, deltas: world.riverDeltas.length });
    check('all generated birds start in approved marsh habitat', initialBirds.every(unit => birds.marshBirdHabitat(world, unit.x, unit.y)));
    const positions = new Map(initialBirds.map(unit => [unit.id, { x: unit.x, y: unit.y }]));
    let waterSamples = 0, invalidSamples = 0, moved = 0;
    // Exercise the production wildlife updates over grazing/wandering cycles.
    for (let step = 0; step < 1200; step++) {
      game.time += .1; hunting.updateWildlife(game);
      for (const unit of flock()) {
        hunting.updateHerdAnimal(game, unit, .1, simulation.moveUnit);
        const delta = game.wildlife.herds.find(herd => herd.id === unit.herdId)?.delta;
        if (!birds.marshBirdHabitat(world, unit.x, unit.y, delta)) invalidSamples++;
        if (WATER.has(tileAt(world, unit.x, unit.y)?.terrain)) waterSamples++;
      }
    }
    for (const unit of flock()) if (Math.hypot(unit.x - positions.get(unit.id).x, unit.y - positions.get(unit.id).y) > .5) moved++;
    check('flocks forage through land and water without leaving marsh habitat', waterSamples > 0 && invalidSamples === 0 && moved > 0, { waterSamples, invalidSamples, moved, simulatedSeconds: 120 });
    const target = document.createElement('canvas'), minimap = document.createElement('canvas');
    target.style.cssText = 'width:1200px;height:800px;display:block'; minimap.width = minimap.height = 160;
    document.body.replaceChildren(target, minimap);
    const renderer = new Renderer(target, minimap); await renderer.initialize(); renderer.follow = false;
    const drawFog = renderer.gpu.drawFog.bind(renderer.gpu); renderer.gpu.drawFog = () => {};
    const frame = state => { renderer.draw(state, 0); return renderer.snapshot(); };
    const explore = w => ({ width: w.width, height: w.height, seed: w.seed, explored: Array(w.tiles.length).fill(1), buildings: [], fields: [] });
    const near = (a, b, radius) => Math.hypot(a.x - b.x, a.y - b.y) < radius;
    const waterBirds = flock().filter(unit => WATER.has(tileAt(world, unit.x, unit.y)?.terrain));
    const openCanopy = unit => ![0, 1, 2].some(dy => [-1, 0, 1].some(dx => tileAt(world, unit.x + dx, unit.y + dy)?.marsh));
    const score = unit => waterBirds.filter(other => near(unit, other, 5)).reduce((sum, other) => sum + (openCanopy(other) ? 5 : 1), 0)
      - game.buildings.filter(building => near(unit, building, 8)).length;
    const visibleBird = waterBirds.sort((a, b) => score(b) - score(a))[0] ?? flock()[0];
    const leader = game.units.find(unit => unit.kind === 'leader' && unit.faction === 0);
    leader.x = visibleBird.x + 2; leader.y = visibleBird.y + 2;
    game.fog = explore(world); game.paused = true; game.selected = null; game.buildMode = null;
    renderer.camera = { x: visibleBird.x, y: visibleBird.y }; renderer.zoom = 2;
    pictures['marsh-flock-close'] = frame(game).toDataURL();
    renderer.zoom = 1; pictures['marsh-flock-game'] = frame(game).toDataURL();
    frame(game); frame(game);
    check('steady bird frames reuse shared textures', renderer.renderStats.textureUploads === 0, renderer.renderStats);
    renderer.gpu.drawFog = drawFog; pictures['marsh-flock-with-fog'] = frame(game).toDataURL(); renderer.gpu.drawFog = () => {};

    const fixtureWidth = 40, fixtureHeight = 30;
    const fixtureWorld = { width: fixtureWidth, height: fixtureHeight, seed: 'BIRD-DEPTH', source: 'QA', spawns: [], tiles: Array.from({ length: fixtureWidth * fixtureHeight }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .1, moisture: .9, food: 3, production: 1, gold: 0, variation: 0 })) };
    const fixture = { ...game, world: fixtureWorld, units: [], buildings: [], fields: [], villages: [], treasures: [], treeStumps: [], bloodEffects: [], unitDeaths: [], particles: [], projectiles: [], fog: explore(fixtureWorld), time: 0 };
    const testBird = { ...visibleBird, faction: 0, id: 999991, hp: visibleBird.maxHp, moving: false, x: 10.5, y: 10.35, damageFlashAt: undefined, lastDamagedAt: undefined };
    renderer.camera = { x: 10.5, y: 10 }; renderer.zoom = 2;
    const plant = fixtureWorld.tiles[10 * fixtureWidth + 10]; plant.marsh = true;
    const difference = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
    const background = imagePixels(frame(fixture)); fixture.units = [testBird];
    const behind = imagePixels(frame(fixture)); pictures['bird-behind-reeds'] = frame(fixture).toDataURL();
    testBird.y = 10.55; const front = imagePixels(frame(fixture)); pictures['bird-in-front'] = frame(fixture).toDataURL();
    check('reed depth ordering hides birds behind and exposes birds in front', difference(background, behind) === 0 && difference(background, front) > 40, { behind: difference(background, behind), front: difference(background, front) });

    const foodBefore = game.factions[0].food, bird = flock()[0]; bird.hp = 0;
    hunting.rewardHunt(game, { faction: 0 }, bird); hunting.rewardHunt(game, { faction: 0 }, bird);
    check('each bird awards exactly twenty food once with matching feedback', game.factions[0].food === foodBefore + 20 && game.particles.some(particle => particle.text === '+20 food'), { before: foodBefore, after: game.factions[0].food });
    leader.x = bird.x + 1; leader.y = bird.y + 1; renderer.camera = { x: bird.x, y: bird.y }; renderer.zoom = 2;
    pictures['bird-hunt-reward'] = frame(game).toDataURL();
    renderer.destroy();
    return { checks, pictures, generated: { seed: world.seed, deltas: world.riverDeltas.length, birds: initialBirds.length, flocks: herdIds.size } };
  });
  for (const [name, uri] of Object.entries(result.pictures)) await writeFile(`${folder}/${name}.png`, Buffer.from(uri.split(',')[1], 'base64'));
  delete result.pictures;
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
  await writeFile(`${folder}/browser-checks.json`, JSON.stringify({ ...result, errors, failedRequests }, null, 2));
  console.log(JSON.stringify({ passed: result.checks.length, generated: result.generated }, null, 2));
} catch (error) { console.error(JSON.stringify({ errors, failedRequests }, null, 2)); throw error; }
finally { await browser.close(); }
