import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'scratch/2026-10-30-wheat-movement';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`); });
await page.addInitScript(() => { requestAnimationFrame = () => 0; });
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready', null, { polling: 50, timeout: 60000 });
  const result = await page.evaluate(async () => {
    const { PixiScene } = await import('/src/game/pixi-scene.ts');
    const { drawUnit } = await import('/src/game/sprites.ts');
    const { fieldStage } = await import('/src/game/farm-art.ts');
    const { invalidateFog } = await import('/src/game/fog.ts');
    const renderer = window.__game.renderer, width = renderer.width, height = renderer.height;
    const reference = new PixiScene(); await reference.initialize(document.createElement('canvas'), width, height, 1);
    const leader = { id: 1, kind: 'leader', faction: 0, x: 10.5, y: 6.5, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: 4, order: 'follow', cooldown: 0, lastCombat: -100,
      moving: true, facing: 0, attackTime: 0 };
    const state = { world: { width: 32, height: 24, seed: 'wheat-walk', source: 'fixture', spawns: [], revision: 1,
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
      units: [leader], buildings: [], factions: [{ id: 0, name: 'Roma', color: '#f34f59', relation: 'self', defeated: false,
        population: 5, gold: 500, food: 500, production: 0, yields: { food: 0, gold: 0, production: 0 } }],
      fields: Array.from({ length: 10 }, (_, n) => n + 4).flatMap(y => [8, 9, 10, 11, 12, 13].map(x => ({
        id: y * 32 + x, camp: 50, faction: 0, x, y, planted: true, food: 0, nextHarvest: 0 }))),
      time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], selected: null, selectedType: null,
      buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'wheat-walk', rngState: 1 };
    renderer.follow = false; renderer.camera = { x: 10.5, y: 7 }; renderer.drawMinimap = () => {};
    const checks = [];
    // Measure the pre-fix source of flicker: switching from native art to a
    // baked copy changes head/body pixels before wheat even masks the feet.
    reference.beginFrame(); reference.sprite(reference.art.unit(leader, 0, '#f34f59'), 50, 50);
    reference.sprite(reference.art.paint('old-wheat-copy', { x: -8, y: -8, width: 50, height: 50 },
      c => drawUnit(c, leader, 0, 0, 32, 0, '#f34f59')), 150, 50); reference.finishFrame();
    let oldSamplingDifferences = 0;
    const old = reference.snapshot().getContext('2d').getImageData(0, 0, width, height).data;
    for (let y = 35; y < 70; y++) for (let x = 35; x < 95; x++)
      if ([0, 1, 2].some(k => old[(y * width + x) * 4 + k] !== old[(y * width + x + 100) * 4 + k])) oldSamplingDifferences++;
    const film = document.createElement('canvas'); film.width = 768; film.height = 192;
    const filmContext = film.getContext('2d'); filmContext.imageSmoothingEnabled = false;
    let picture = 0, maxDifferences = 0, comparedPixels = 0;
    for (const zoom of [1, 1.5, 2]) for (const kind of ['leader', 'warrior', 'worker', 'archer', 'merchant', 'boar']) {
      leader.kind = kind; renderer.zoom = zoom;
      for (const y of [6.02, 6.5, 6.94, 6.98, 7, 7.02, 7.06, 7.5]) {
        leader.y = y; invalidateFog(state); renderer.draw(state, 0);
        const size = 32 * zoom, ox = width / 2 - renderer.camera.x * size, oy = height / 2 - renderer.camera.y * size;
        const person = kind !== 'boar', top = leader.y - (person ? .85 : .5), feet = leader.y + (person ? 0 : .5);
        const sx = Math.round(ox + (leader.x - .5) * size), sy = Math.round(oy + top * size);
        reference.beginFrame(); reference.sprite(reference.art.unit(leader, state.time, '#f34f59'), sx, sy, zoom); reference.finishFrame();
        const expectedCanvas = reference.renderer.extract.canvas({ target: reference.stage, frame: reference.renderer.screen, resolution: 1, clearColor: [0, 0, 0, 0] });
        const expected = expectedCanvas.getContext('2d').getImageData(0, 0, width, height).data;
        const actualCanvas = renderer.gpu.snapshot(), actual = actualCanvas.getContext('2d').getImageData(0, 0, width, height).data;
        let differences = 0, compared = 0;
        for (let py = Math.max(0, sy - 8 * zoom); py < oy + (feet - .4) * size; py++) for (let px = Math.max(0, sx - 8 * zoom); px < sx + 42 * zoom; px++) {
          const index = (Math.floor(py) * width + Math.floor(px)) * 4;
          // The merchant PNG contains partially transparent edge pixels; their
          // RGB naturally depends on the ground underneath. Compare opaque art.
          if (expected[index + 3] !== 255) continue;
          comparedPixels++; compared++;
          if ([0, 1, 2].some(k => expected[index + k] !== actual[index + k])) differences++;
        }
        maxDifferences = Math.max(maxDifferences, differences);
        checks.push({ kind, zoom, y, differences, compared });
        if (kind === 'leader' && zoom === 2 && picture < 8) {
          filmContext.drawImage(actualCanvas, width / 2 - 48, oy + (6 - .85) * size - 8, 96, 192,
            picture++ * 96, 0, 96, 192);
        }
      }
    }
    leader.kind = 'leader'; renderer.zoom = 2;
    for (let frame = 0; frame < 160; frame++) { leader.x = 9.5 + frame / 80; leader.y = 6.5 + frame / 80;
      state.time = frame / 60; renderer.draw(state, 0); }
    renderer.draw(state, 0); const warm = { ...renderer.gpu.stats };
    reference.destroy();
    return { checks, oldSamplingDifferences, comparedPixels, maxDifferences, stage: fieldStage(state.fields[0], state.time), warm, film: film.toDataURL() };
  });
  await writeFile(`${out}/crossing.png`, Buffer.from(result.film.split(',')[1], 'base64')); delete result.film;
  await writeFile(`${out}/checks.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ scenarios: result.checks.length, oldSamplingDifferences: result.oldSamplingDifferences,
    comparedPixels: result.comparedPixels, maxDifferences: result.maxDifferences, warm: result.warm, errors }, null, 2));
  assert.ok(result.oldSamplingDifferences > 0, 'baseline demonstrates native/baked sprite mismatch');
  assert.equal(result.stage, 3, 'walk uses ripe wheat');
  assert.ok(result.checks.every(check => check.compared > 0), 'every scenario compares visible opaque unit pixels');
  assert.equal(result.maxDifferences, 0, 'all upper-body pixels remain identical to native unit art');
  assert.equal(result.warm.rasterized, 0, 'a warmed stationary frame rerasterizes no unit or wheat art');
  assert.deepEqual(errors, []);
} catch (error) { console.error({ browserErrors: errors, status: await page.evaluate(() => ({ assets: document.documentElement.dataset.assets, body: document.body.innerText.slice(0, 300) })) }); throw error; }
finally { await browser.close(); }
