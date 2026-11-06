import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// This entire showcase uses a new ephemeral browser context. The player's
// running game, local save, camera, and unit orders are never touched.
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
mkdirSync('output', { recursive: true });
const report = {};
const check = label => console.log(`PASS ${label}`);

try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game);
  await page.evaluate(() => {
    window.__game.newWorld('BTV-units-roads');
    window.__game.state.paused = true;
  });

  const spriteChecks = await page.evaluate(async () => {
    const { drawUnit, drawBuilding } = await import('/src/game/sprites.ts');
    const { loadPunyCharacters, PUNY_CHARACTERS } = await import('/src/game/unit-sprites.ts');
    await loadPunyCharacters();
    const { state } = window.__game;
    const base = state.units.find(u => u.faction === 0 && u.kind === 'warrior');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const c = canvas.getContext('2d');
    const draw = (changes, time = 0) => {
      c.clearRect(0, 0, 96, 96);
      drawUnit(c, { ...base, id: 0, hp: 100, moving: false, attackTime: 0, facing: 0, ...changes }, 32, 32, 32, time, '#3988ff');
      const data = c.getImageData(0, 0, 96, 96).data;
      let left = 96, top = 96, right = 0, bottom = 0, pixels = 0;
      for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (data[(y * 96 + x) * 4 + 3] > 100) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y); pixels++;
      }
      return { image: canvas.toDataURL(), bounds: { left, top, right, bottom, pixels } };
    };
    const roles = ['leader', 'warrior', 'worker'].map(kind => {
      const facings = Array.from({ length: 8 }, (_, i) => draw({ kind, facing: i * Math.PI / 4 }));
      const walk = Array.from({ length: 8 }, (_, i) => draw({ kind, moving: true, facing: Math.PI / 4 }, i / 16));
      const attack = draw({ kind, attackTime: .2, facing: Math.PI / 4 });
      return { kind, uniqueFacings: new Set(facings.map(f => f.image)).size,
        northSouthDifferent: facings[2].image !== facings[6].image,
        movingFrames: new Set(walk.map(f => f.image)).size,
        attackDifferent: attack.image !== facings[1].image,
        workingFrames: new Set([0, .25, .5, .75].map(time => draw({ kind, order: 'work', facing: Math.PI / 4 }, time).image)).size,
        attackPhases: Array.from({ length: 8 }, (_, direction) => new Set([.26, .10, .02].map(attackTime => draw({ kind, attackTime, facing: direction * Math.PI / 4 }).image)).size),
        bounds: facings.map(f => f.bounds), attackBounds: attack.bounds };
    });
    const directions = ['north', 'east', 'south', 'west'];
    const road = { id: 50, kind: 'road', faction: 0, x: 15, y: 18, hp: 100, maxHp: 100, capacity: 0 };
    const drawRoad = (links, changes = {}, time = 0) => {
      c.clearRect(0, 0, 96, 96);
      drawBuilding(c, { ...road, ...changes }, 32, 32, 32, time, '#3988ff', links);
      return { image: canvas.toDataURL(), data: c.getImageData(0, 0, 96, 96).data };
    };
    const alpha = (data, x, y) => data[(y * 96 + x) * 4 + 3];
    const masks = Array.from({ length: 16 }, (_, mask) => {
      const links = Object.fromEntries(directions.map((name, i) => [name, !!(mask & (1 << i))]));
      const { image, data } = drawRoad(links);
      const joins = directions.filter(name => links[name]).map(name => {
        let solid = 0;
        for (let offset = -3; offset <= 3; offset++) {
          const x = name === 'east' ? 63 : name === 'west' ? 32 : 48 + offset;
          const y = name === 'south' ? 63 : name === 'north' ? 32 : 48 + offset;
          if (alpha(data, x, y) >= 200) solid++;
        }
        return { side: name, solid };
      });
      return { mask, joins, stableAcrossIdAndTime: image === drawRoad(links, { id: 999 }, 31).image };
    });
    // For each axis, check the center of a real join across two individually
    // positioned tiles. This catches local canvas clipping and tile-edge gaps.
    const seams = ['horizontal', 'vertical'].map(axis => {
      c.clearRect(0, 0, 96, 96);
      const horizontal = axis === 'horizontal';
      const links = { north: !horizontal, east: horizontal, south: !horizontal, west: horizontal };
      drawBuilding(c, road, 16, 16, 32, 0, '#3988ff', links);
      drawBuilding(c, { ...road, x: road.x + +horizontal, y: road.y + +!horizontal, id: road.id + 1 }, horizontal ? 48 : 16, horizontal ? 16 : 48, 32, 0, '#3988ff', links);
      const data = c.getImageData(0, 0, 96, 96).data;
      let missing = 0;
      for (let along = 42; along <= 54; along++) for (let across = 30; across <= 34; across++) {
        if (alpha(data, horizontal ? along : across, horizontal ? across : along) < 200) missing++;
      }
      return { axis, missing };
    });
    const sourceSheets = Object.entries(PUNY_CHARACTERS).map(([role, definition]) => ({ role, file: definition.file }));
    const marauder = draw({ kind: 'warrior', marauderPack: 1 }).image;
    const soldier = draw({ kind: 'warrior', marauderPack: undefined }).image;
    return { roles, masks, seams, sourceSheets, marauderDistinct: marauder !== soldier };
  });
  report.sprites = spriteChecks;
  for (const role of spriteChecks.roles) {
    assert.ok(role.uniqueFacings >= 5, `${role.kind}: front, back, side, and diagonal views must be distinct`);
    assert.ok(role.northSouthDifferent, `${role.kind}: north and south cannot share a face-on pose`);
    assert.ok(role.movingFrames >= 3, `${role.kind}: walking must animate more than a two-frame blink`);
    if (role.kind === 'worker') assert.ok(role.workingFrames >= 2, 'Worker: farming must animate its tool');
    else {
      assert.ok(role.attackDifferent, `${role.kind}: attacking must have a distinct pose`);
      role.attackPhases.forEach((phases, direction) => assert.equal(phases, 3, `${role.kind}: direction ${direction} needs distinct windup, strike, and recovery`));
    }
    for (const bounds of [...role.bounds, role.attackBounds]) {
      assert.ok(bounds.pixels > 100, `${role.kind}: sprite must remain legible at native resolution`);
      assert.ok(bounds.left > 0 && bounds.top > 0 && bounds.right < 95 && bounds.bottom < 95, `${role.kind}: sprite cannot clip its diagnostic cell`);
    }
  }
  assert.ok(spriteChecks.marauderDistinct, 'Marauders use the separate Puny orc sheet');
  check('Puny source sheets, eight directional views, walking frames, attack poses, and native-resolution silhouettes');
  for (const road of spriteChecks.masks) {
    assert.ok(road.stableAcrossIdAndTime, `Road mask ${road.mask}: texture must be tied to world position`);
    for (const join of road.joins) assert.ok(join.solid >= 5, `Road mask ${road.mask}: ${join.side} join must stay solid`);
  }
  spriteChecks.seams.forEach(seam => assert.equal(seam.missing, 0, `${seam.axis} road joins must not have gaps`));
  check('all 16 road connection masks, deterministic texture, and seamless adjacent tile centers');

  await page.evaluate(async () => {
    const { terrainYields } = await import('/src/world/generator.ts');
    const { state, renderer } = window.__game;
    const width = 64, height = 64;
    const variation = (x, y) => ((Math.imul(x + 11, 73856093) ^ Math.imul(y + 23, 19349663)) >>> 0) / 4294967296;
    const tiles = Array.from({ length: width * height }, (_, i) => {
      const x = i % width, y = Math.floor(i / width), v = variation(x, y);
      const terrain = x < 4 || y < 4 || x > 59 || y > 59 ? 'ocean' : x === 24 ? 'river' : 'grassland';
      const overlay = terrain === 'grassland' && ((x < 10 || x > 29 || y < 9 || y > 24) && v > .2) ? 'forest' : 'none';
      return { terrain, overlay, elevation: .3, moisture: .6, variation: v, ...terrainYields(terrain, overlay) };
    });
    const tile = (x, y) => tiles[y * width + x];
    let nextId = 1000;
    const buildings = [], occupied = new Set();
    const put = (kind, x, y) => {
      if (occupied.has(`${x},${y}`)) return;
      occupied.add(`${x},${y}`);
      buildings.push({ id: nextId++, kind, faction: 0, x, y, hp: 100, maxHp: 100, capacity: kind === 'cottage' ? 8 : 0, connected: true });
      tile(x, y).overlay = 'none';
    };
    const line = (x1, y1, x2, y2) => {
      const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
      for (let step = 0; step <= Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)); step++) {
        const x = x1 + dx * step, y = y1 + dy * step;
        put(x === 24 ? 'bridge' : 'road', x, y);
      }
    };
    // Winding path, rounded corners, a T, a cross, dead ends, and a bridge.
    line(11, 12, 13, 12); line(13, 12, 13, 13); line(13, 13, 14, 13);
    line(14, 13, 14, 14); line(14, 14, 15, 14); line(15, 14, 15, 15); line(15, 15, 20, 15);
    line(20, 15, 20, 18); line(20, 18, 28, 18); line(19, 10, 19, 15);
    line(17, 12, 22, 12); line(27, 18, 27, 21); line(27, 21, 29, 21);
    put('cottage', 21, 21); put('camp', 16, 10);
    for (const [x, y] of [[20, 21], [20, 22], [21, 22]]) tile(x, y).farm = 0;
    const originals = Object.fromEntries(['leader', 'warrior', 'worker'].map(kind => [kind, state.units.find(u => u.faction === 0 && u.kind === kind)]));
    const unit = (kind, x, y, facing, faction = 0, changes = {}) => ({ ...originals[kind], id: nextId++, x, y, facing, faction, hp: 100, moving: false, attackTime: 0, path: undefined, destination: undefined, target: undefined, work: undefined, order: kind === 'worker' ? 'work' : 'follow', ...changes });
    const leader = unit('leader', 16.5, 16.9, Math.PI / 4);
    window.__game.entities(state).units.replace([leader,
      unit('warrior', 16.5, 15.5, -Math.PI / 4), unit('warrior', 18.0, 17.2, Math.PI / 4, 0, { moving: true }),
      unit('warrior', 17.8, 18.9, -Math.PI / 2, 0, { hp: 76 }), unit('worker', 14.625, 14.375, Math.PI / 4, 0, { moving: true }),
      unit('worker', 20.5, 21.5, Math.PI / 4), unit('worker', 20.5, 22.4, Math.PI),
      unit('leader', 26.5, 15.6, Math.PI * 3 / 4, 3), unit('warrior', 27.8, 17.0, Math.PI, 3, { attackTime: .2 }),
      unit('warrior', 26.5, 19.8, -Math.PI * 3 / 4, 3), unit('warrior', 22.0, 13.6, Math.PI / 2, 1),
      unit('worker', 21.9, 10.7, 0, 1), unit('warrior', 13.0, 19.8, 0, 2), unit('worker', 12.7, 18.2, -Math.PI / 4, 2),
    ]);
    state.world = { width, height, tiles, spawns: [{ x: leader.x, y: leader.y }], seed: 'BTV-units-roads-showcase', source: 'Deterministic visual QA fixture', revision: 1 };
    state.seed = state.world.seed; state.time = .22; state.paused = true;
    window.__game.entities(state).buildings.replace(buildings); state.selected = leader.id; state.selectedType = 'unit';
    state.particles = []; state.buildMode = null; state.gameOver = false;
    renderer.follow = false; renderer.camera = { x: 20, y: 17 }; renderer.zoom = 2;
    renderer.hover = null; renderer.prepare(state); renderer.draw(state, 0);
  });
  await page.mouse.move(1400, 24);
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'output/btv-units-roads.png' });
  for (const zoom of [.65, 1.35, 2.2]) {
    const sample = await page.evaluate(zoom => {
      const { state, renderer } = window.__game;
      renderer.zoom = zoom;
      const times = [];
      for (let i = 0; i < 5; i++) renderer.draw(state, 0);
      for (let i = 0; i < 30; i++) {
        const start = performance.now(); renderer.draw(state, 0); times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const bounds = renderer.canvas.getBoundingClientRect();
      return { zoom, medianDrawMs: times[15], p95DrawMs: times[28], width: bounds.width, height: bounds.height, backingWidth: renderer.canvas.width, backingHeight: renderer.canvas.height };
    }, zoom);
    assert.equal(sample.width, 1440); assert.equal(sample.height, 1040);
    assert.equal(sample.backingWidth, 1440); assert.equal(sample.backingHeight, 1040);
    (report.rendering ??= []).push(sample);
    await page.waitForTimeout(100);
    await page.screenshot({ path: `output/btv-units-zoom-${String(zoom).replace('.', '-')}.png` });
    console.log(`Zoom ${zoom}: cached draw median ${sample.medianDrawMs.toFixed(1)} ms, p95 ${sample.p95DrawMs.toFixed(1)} ms`);
  }
  check('showcase screenshots, correct canvas resolution, and low/normal/high zoom rendering');

  const sheet = await page.evaluate(async () => {
    const { drawUnit, drawBuilding } = await import('/src/game/sprites.ts');
    const { loadPunyCharacters, PUNY_CHARACTERS } = await import('/src/game/unit-sprites.ts');
    await loadPunyCharacters();
    const { state } = window.__game;
    const canvas = document.createElement('canvas'); canvas.width = 1120; canvas.height = 1460;
    const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false;
    c.fillStyle = '#26382b'; c.fillRect(0, 0, 1120, 1460);
    c.fillStyle = '#e3d4ae'; c.font = '16px monospace'; c.fillText('BTV / DIRECTION, MOTION, AND ROAD CONNECTION REVIEW', 24, 30);
    const roles = ['leader', 'warrior', 'worker'];
    const facingNames = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
    roles.forEach((kind, row) => {
      const base = state.units.find(u => u.kind === kind && u.faction === 0);
      c.fillStyle = '#e3d4ae'; c.font = '14px monospace'; c.fillText(kind.toUpperCase(), 24, 65 + row * 168);
      facingNames.forEach((name, col) => {
        const x = 28 + col * 136, y = 74 + row * 168;
        drawUnit(c, { ...base, id: 0, moving: false, facing: col * Math.PI / 4, attackTime: 0 }, x, y, 128, 0, '#3988ff');
        c.fillStyle = '#abbea1'; c.fillText(name, x + 56, y + 144);
      });
    });
    const warrior = state.units.find(u => u.kind === 'warrior' && u.faction === 0);
    c.fillStyle = '#e3d4ae'; c.fillText('WALK / ATTACK / FACTION COLORS', 24, 590);
    for (let col = 0; col < 8; col++) {
      const x = 28 + col * 136;
      drawUnit(c, { ...warrior, id: 0, moving: col < 4, facing: Math.PI / 4, attackTime: col === 4 ? .2 : 0 }, x, 610, 128, col / 10, state.factions[Math.max(0, col - 4)]?.color ?? '#3988ff');
      c.fillStyle = '#abbea1'; c.fillText(col < 4 ? `walk ${col + 1}` : col === 4 ? 'attack' : `color ${col - 3}`, x + 10, 754);
    }
    c.fillStyle = '#e3d4ae'; c.fillText('ROAD MASKS / N E S W', 24, 790);
    const dirs = ['north', 'east', 'south', 'west'];
    for (let mask = 0; mask < 16; mask++) {
      const x = 32 + (mask % 8) * 136, y = 815 + Math.floor(mask / 8) * 170;
      const links = Object.fromEntries(dirs.map((name, i) => [name, !!(mask & (1 << i))]));
      c.fillStyle = '#668846'; c.fillRect(x, y, 96, 96);
      drawBuilding(c, { id: mask + 100, kind: 'road', x: mask % 8, y: Math.floor(mask / 8), faction: 0, hp: 100, maxHp: 100, capacity: 0 }, x, y, 96, 0, '#3988ff', links);
      c.fillStyle = '#abbea1'; c.fillText(dirs.filter(d => links[d]).map(d => d[0].toUpperCase()).join('') || 'isolated', x + 8, y + 118);
    }
    c.fillStyle = '#e3d4ae'; c.fillText('LEADER / WARRIOR — WINDUP, STRIKE, RECOVERY', 24, 1145);
    ['leader', 'warrior'].forEach((kind, role) => {
      const base = state.units.find(u => u.kind === kind && u.faction === 0);
      [.26, .15, .05].forEach((attackTime, phase) => {
        const x = 32 + (role * 3 + phase) * 180;
        drawUnit(c, { ...base, id: 0, moving: false, facing: Math.PI / 4, attackTime }, x, 1165, 128, 0, '#3988ff');
        c.fillStyle = '#abbea1'; c.fillText(['windup', 'strike', 'recover'][phase], x + 28, 1309);
      });
    });
    c.fillStyle = '#e3d4ae'; c.fillText('NATIVE 32PX / LEADER, WARRIOR, WORKER', 24, 1345);
    roles.forEach((kind, row) => {
      const base = state.units.find(u => u.kind === kind && u.faction === 0);
      for (let direction = 0; direction < 8; direction++) {
        drawUnit(c, { ...base, id: 0, moving: false, facing: direction * Math.PI / 4, attackTime: 0 }, 24 + (row * 8 + direction) * 45, 1365, 32, 0, '#3988ff');
      }
    });
    return canvas.toDataURL('image/png').split(',')[1];
  });
  writeFileSync('output/btv-unit-sprite-sheet.png', Buffer.from(sheet, 'base64'));
  assert.deepEqual(errors, []);
  report.runtimeErrors = errors;
  writeFileSync('output/btv-units-report.json', `${JSON.stringify(report, null, 2)}\n`);
  check('enlarged sprite contact sheet and no browser runtime errors');
} finally {
  await context.close();
  await browser.close();
}
