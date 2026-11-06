import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// A disposable context verifies pixels without modifying the player's save.
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const check = name => console.log(`PASS ${name}`);
mkdirSync('output', { recursive: true });

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  const result = await page.evaluate(async () => {
    const { updateFog, entityVisible, isVisible, isExplored, FOG_RETURN_DELAY, FOG_RETURN_FADE, FOG_REVEAL_FADE } = await import('/src/game/fog.ts');
    const { state, renderer } = window.__game;
    state.paused = true;
    state.time = 0;
    state.particles = [];
    state.events = [];
    state.fields = [];
    state.buildMode = null;
    const width = 64, height = 48;
    state.world = {
      width, height, seed: 'fog-qa', source: 'QA', spawns: [],
      tiles: Array.from({ length: width * height }, () => ({
        terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5,
        food: 2, production: 1, gold: 0, variation: .3,
      })),
    };
    const base = state.units.find(u => u.kind === 'leader' && u.faction === 0);
    const leader = { ...base, x: 40.5, y: 20.5, moving: false, attackTime: 0, hp: 100, morale: 100, order: 'follow' };
    const enemy = { ...base, id: 991, faction: 1, kind: 'warrior', x: 40.5, y: 20.5 };
    window.__game.entities(state).units.replace([leader, enemy]);
    window.__game.entities(state).buildings.replace([]);
    state.fog = undefined;
    updateFog(state);
    leader.x = 10.5; leader.y = 12.5;
    updateFog(state);
    renderer.follow = false;
    renderer.camera = { x: 30, y: 20 };
    renderer.zoom = .9;
    renderer.hover = null;
    renderer.buildPreview = [];
    renderer.prepare(state);
    renderer.draw(state, 0);
    const before = renderer.canvas.toDataURL(), miniBefore = renderer.minimap.toDataURL();
    enemy.x = 44.5; enemy.y = 21.5; enemy.facing = 2; enemy.hp = 30; enemy.attackTime = .2;
    renderer.draw(state, 0);
    const hiddenMovementStable = before === renderer.canvas.toDataURL();
    const hiddenMinimapStable = miniBefore === renderer.minimap.toDataURL();
    const enemyHidden = !entityVisible(state, enemy);

    // Inspect the actual composited sub-tile mask. Sight remains cell-aligned;
    // only the known side of the visual frontier receives a short falloff.
    const fogContext = renderer.fogCanvas.getContext('2d');
    const alpha = (x, y) => { const scale = renderer.fogCanvas.width / state.world.width; return fogContext.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data[3]; };
    const edge = Array.from({ length: 33 }, (_, i) => alpha(18 + i * .125, 12.5));
    const unknownAlpha = alpha(60, 40), memoryAlpha = alpha(40.5, 20.5), visibleAlpha = alpha(10.5, 12.5);
    const mini = renderer.minimap;
    const miniUnknown = Array.from(mini.getContext('2d').getImageData(Math.floor(60 / 64 * mini.width), Math.floor(40 / 48 * mini.height), 1, 1).data);
    state.selectedType = 'unit'; state.selected = leader.id;
    renderer.draw(state, 0);
    const selected = renderer.canvas.toDataURL();
    state.selected = null; state.selectedType = null;
    renderer.draw(state, 0);
    const selectionStable = selected === renderer.canvas.toDataURL();
    const fogBefore = state.fog.explored.reduce((a, n) => a + n, 0);
    leader.x = 30.5;
    updateFog(state);
    const fogAfter = state.fog.explored.reduce((a, n) => a + n, 0);
    const restored = JSON.parse(JSON.stringify(state));
    const persisted = isExplored(restored, 10.5, 12.5) && !isVisible(restored, 10.5, 12.5);

    // A woodland strip must obstruct the actual main-map/minimap mask even
    // when both the observer and target stand in clearings on opposite sides.
    state.fog = undefined;
    leader.x = 10.5; leader.y = 12.5;
    enemy.x = 17.5; enemy.y = 12.5;
    window.__game.entities(state).units.replace([leader, enemy]);
    for (let y = 0; y < height; y++) for (const x of [12, 13]) state.world.tiles[y * width + x].overlay = 'forest';
    state.world.revision = (state.world.revision ?? 0) + 1;
    renderer.prepare(state); renderer.draw(state, 0);
    const woodedBefore = renderer.canvas.toDataURL(), woodedMiniBefore = renderer.minimap.toDataURL();
    const woodland = { hidden: !entityVisible(state, enemy), explored: isExplored(state, 17.5, 12.5),
      blockedAlpha: alpha(17.5, 12.5), observerAlpha: alpha(10.5, 12.5) };
    enemy.x = 18.5; enemy.facing = 1; enemy.hp = 15;
    renderer.draw(state, 0);
    woodland.hiddenMovementStable = woodedBefore === renderer.canvas.toDataURL();
    woodland.hiddenMinimapStable = woodedMiniBefore === renderer.minimap.toDataURL();
    for (let y = 0; y < height; y++) for (const x of [12, 13]) state.world.tiles[y * width + x].overlay = 'none';
    state.world.revision++;
    renderer.prepare(state); renderer.draw(state, 0);
    woodland.clearedVisible = entityVisible(state, enemy);
    woodland.clearedAlphaImmediate = alpha(17.5, 12.5);
    // A newly requested target is ingested at the next20Hz visual tick.
    state.time += .05;
    renderer.draw(state, 0);
    state.time += FOG_REVEAL_FADE + .05;
    renderer.draw(state, 0);
    woodland.clearedAlpha = alpha(17.5, 12.5);

    // Keep vision constant with a nearby building. Tree crowns and walkers
    // share footing depth: a walker is covered behind the trunk and visible
    // after crossing its lower edge. Scenery never fades around the walker.
    window.__game.entities(state).units.replace([{ ...leader, x: 12.5, y: 20.5 }]);
    const walker = { ...enemy, id: 992, faction: 0, x: 12.5, y: 12.75, hp: 100, morale: 100, attackTime: 0 };
    window.__game.entities(state).buildings.replace([{ id: 600, kind: 'camp', faction: 0, x: 11, y: 12, hp: 100, maxHp: 100, capacity: 1 }]);
    renderer.camera = { x: 12.5, y: 12.5 };
    renderer.zoom = 2;
    const { drawUnit } = await import('/src/game/sprites.ts');
    const { drawVegetation, vegetationRenderDepth } = await import('/src/game/vegetation-art.ts');
    const reference = document.createElement('canvas');
    reference.width = renderer.canvas.width;
    reference.height = renderer.canvas.height;
    const rc = reference.getContext('2d');
    rc.imageSmoothingEnabled = false;
    const origin = renderer.screenPoint({ x: 12, y: 12 });
    const layers = [];
    for (const position of ['behind', 'front']) {
      walker.y = vegetationRenderDepth(12) + (position === 'behind' ? -.1875 : .125);
      const unitOrigin = renderer.screenPoint({ x: walker.x - .5, y: walker.y - .85 });
      rc.clearRect(0, 0, reference.width, reference.height);
      drawUnit(rc, walker, unitOrigin.x, unitOrigin.y, 64, 0, state.factions[0].color);
      const unitPixels = rc.getImageData(0, 0, reference.width, reference.height).data;
      const tile = state.world.tiles[12 * 64 + 12]; tile.overlay = 'forest';
      state.world.revision = (state.world.revision ?? 0) + 1;
      renderer.prepare(state);
      renderer.draw(state, 0);
      state.time += .05;
      renderer.draw(state, 0);
      state.time += FOG_RETURN_DELAY + FOG_RETURN_FADE + .1;
      renderer.draw(state, 0);
      const withoutUnit = (await renderer.snapshot()).getContext('2d').getImageData(0, 0, renderer.canvas.width, renderer.canvas.height).data;
      window.__game.entities(state).units.add(walker);
      renderer.draw(state, 0);
      state.time += .05;
      renderer.draw(state, 0);
      state.time += FOG_REVEAL_FADE + .05;
      renderer.draw(state, 0);
      const withUnit = (await renderer.snapshot()).getContext('2d').getImageData(0, 0, renderer.canvas.width, renderer.canvas.height).data;
      rc.clearRect(0, 0, reference.width, reference.height);
      drawVegetation(rc, tile, origin.x, origin.y, 64);
      const overlayPixels = rc.getImageData(0, 0, reference.width, reference.height).data;
      let sceneryPixels = 0, changedSceneryPixels = 0, opaqueUnitPixels = 0, obscuredUnitPixels = 0, overlapPixels = 0, coveredOverlapPixels = 0;
      for (let i = 0; i < unitPixels.length; i += 4) {
        if (unitPixels[i + 3] === 255) {
          opaqueUnitPixels++;
          if (withUnit[i] !== unitPixels[i] || withUnit[i + 1] !== unitPixels[i + 1] || withUnit[i + 2] !== unitPixels[i + 2]) obscuredUnitPixels++;
          if (overlayPixels[i + 3] === 255) {
            overlapPixels++;
            if (withUnit[i] === withoutUnit[i] && withUnit[i + 1] === withoutUnit[i + 1] && withUnit[i + 2] === withoutUnit[i + 2]) coveredOverlapPixels++;
          }
        }
        if (overlayPixels[i + 3] === 255 && unitPixels[i + 3] === 0) {
          sceneryPixels++;
          if (withUnit[i] !== withoutUnit[i] || withUnit[i + 1] !== withoutUnit[i + 1] || withUnit[i + 2] !== withoutUnit[i + 2]) changedSceneryPixels++;
        }
      }
      layers.push({ position, sceneryPixels, changedSceneryPixels, opaqueUnitPixels, obscuredUnitPixels, overlapPixels, coveredOverlapPixels });
      window.__game.entities(state).units.replace(state.units.slice(0, -1));
    }
    renderer.draw(state, 0);
    const withoutHitNumbers = renderer.canvas.toDataURL();
    state.particles = [{ x: 12.5, y: 12.75, text: '−25', color: '#fff3dd', life: 1.6 }];
    renderer.draw(state, 0);
    const hitNumbersHidden = withoutHitNumbers === renderer.canvas.toDataURL();
    state.particles = [];
    const timings = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      renderer.draw(state, 0);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);

    // Exercise changing sight rather than reporting only the cheap paused cache.
    for (let y = 8; y < 24; y++) for (let x = 17; x < 30; x++) state.world.tiles[y * width + x].overlay = 'forest';
    state.world.revision++;
    window.__game.entities(state).units.replace(Array.from({ length: 12 }, (_, index) => ({ ...walker, id: 1000 + index,
      x: 16.5 + index % 4, y: 11.5 + Math.floor(index / 4) })));
    renderer.camera = { x: 21, y: 16 }; renderer.zoom = 1.35;
    renderer.prepare(state);
    const movingTimings = [];
    for (let frame = 0; frame < 30; frame++) {
      for (const unit of state.units) unit.x += .125;
      state.time += 1 / 30;
      const start = performance.now();
      renderer.draw(state, 0);
      movingTimings.push(performance.now() - start);
    }
    movingTimings.sort((a, b) => a - b);
    return {
      hiddenMovementStable, hiddenMinimapStable, enemyHidden, selectionStable,
      layers, hitNumbersHidden, unknownAlpha, memoryAlpha, visibleAlpha,
      edge, miniUnknown, fogBefore, fogAfter, persisted, woodland,
      medianRenderMs: timings[15], movingWoodlandMedianMs: movingTimings[15], movingWoodlandP95Ms: movingTimings[28],
    };
  });
  assert.equal(result.hiddenMovementStable, true, 'Hidden movement, turning, damage, and attacks must not change world pixels');
  assert.equal(result.hiddenMinimapStable, true, 'Hidden movement must not change minimap pixels');
  assert.equal(result.enemyHidden, true);
  check('unseen enemy movement and combat remain invisible in the world and minimap');
  assert.equal(result.unknownAlpha, 255, 'Unexplored terrain must be opaque black');
  assert.ok(result.memoryAlpha > 100 && result.memoryAlpha < 220, 'Explored terrain outside sight must remain shaded');
  assert.equal(result.visibleAlpha, 0, 'Current sight must be unobscured');
  assert.ok(result.edge.some(alpha => alpha > 0 && alpha < 255), 'Fog frontier should have a short soft transition');
  assert.ok(result.edge.slice(0, 13).every(alpha => alpha === 0), 'Visible interiors must stay flat and fully clear');
  assert.ok(result.edge.slice(16).every(alpha => alpha === 255), 'The entire unexplored side must remain opaque');
  assert.deepEqual(result.miniUnknown, [0, 0, 0, 255]);
  check('black unexplored map, shaded memory, clear interiors, and short pillowy fog edges');
  assert.ok(result.fogAfter > result.fogBefore, 'Moving the scout must reveal more terrain');
  assert.equal(result.persisted, true, 'Exploration must survive JSON saves without preserving current visibility');
  check('scouting expands exploration and saves preserve memory');
  assert.equal(result.woodland.hidden, true);
  assert.equal(result.woodland.explored, false);
  assert.equal(result.woodland.blockedAlpha, 255, 'A forest strip must hide terrain beyond it on the rendered mask');
  assert.equal(result.woodland.observerAlpha, 0);
  assert.equal(result.woodland.hiddenMovementStable, true);
  assert.equal(result.woodland.hiddenMinimapStable, true);
  assert.ok(result.woodland.clearedAlphaImmediate > result.woodland.clearedAlpha, 'Newly clear terrain should fade rather than snap');
  assert.equal(result.woodland.clearedAlpha, 0, 'Clearing trees must refresh the mask for a stationary observer');
  assert.equal(result.woodland.clearedVisible, true);
  check('forest strips block live sight and both rendered maps; clearing restores logical sight immediately and fades the mask');
  assert.equal(result.selectionStable, true, 'Selecting a unit must not draw a ground circle');
  for (const layer of result.layers) {
    assert.ok(layer.opaqueUnitPixels > 100, `${layer.position}: unit fixture must cover a meaningful area`);
    if (layer.position === 'front') assert.equal(layer.obscuredUnitPixels, 0, 'Walkers in front of a tree must remain unobscured');
    else assert.equal(layer.coveredOverlapPixels, layer.overlapPixels, 'Opaque canopy pixels must cover walkers behind the tree footing');
    assert.equal(layer.changedSceneryPixels, 0, `${layer.position}: scenery cannot fade around units`);
  }
  assert.ok(result.layers.every(layer => layer.overlapPixels > 100), 'Forest fixture must place the unit over a meaningful area of the canopy');
  assert.equal(result.hitNumbersHidden, true, 'Damage particles from older saves must not render');
  check('tree footing controls walker occlusion, scenery stays opaque, and hit numbers and selection circles stay hidden');
  assert.deepEqual(errors, []);
  await page.evaluate(() => {
    window.__game.newWorld('BTV-fog-of-war');
    window.__game.state.paused = true;
    window.__game.renderer.zoom = 1.35;
    window.__game.renderer.center(window.__game.state);
    window.__game.renderer.draw(window.__game.state, 0);
  });
  await page.screenshot({ path: 'output/btv-fog.png' });
  writeFileSync('output/btv-fog-report.json', JSON.stringify(result, null, 2));
  console.log(`Saved output/btv-fog.png and output/btv-fog-report.json; cached render median ${result.medianRenderMs.toFixed(2)} ms; 12 moving woodland sources median ${result.movingWoodlandMedianMs.toFixed(2)} ms, p95 ${result.movingWoodlandP95Ms.toFixed(2)} ms`);
} finally {
  await browser.close();
}
