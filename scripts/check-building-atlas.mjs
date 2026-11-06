import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const out = process.env.CHECK_OUT || 'scratch/building-atlas-check';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
  (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(() => { requestAnimationFrame = () => 0; });
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready', null, { polling: 50, timeout: 60000 });
  const result = await page.evaluate(async () => {
    const { PixiScene } = await import('/src/game/pixi-scene.ts');
    const { drawBuilding } = await import('/src/game/sprites.ts');
    const scene = new PixiScene();
    await scene.initialize(document.createElement('canvas'), 256, 128, 1);
    const houses = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, kind: 'house', houseLevel: i + 1,
      x: 0, y: 0, hp: 100, maxHp: 100, faction: 0, capacity: 6 }));
    const reference = (color, buildings = houses) => buildings.map(building => {
      // Match the atlas's authored scale, then sample it down with nearest
      // neighbors. Construction posts have fractional destination coordinates.
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const context = canvas.getContext('2d'); context.setTransform(4, 0, 0, 4, 0, 0);
      drawBuilding(context, building, 0, 0, 32, 0, color);
      const sampled = document.createElement('canvas'); sampled.width = sampled.height = 32;
      const target = sampled.getContext('2d'); target.imageSmoothingEnabled = false;
      target.drawImage(canvas, 0, 0, 32, 32);
      return target.getImageData(0, 0, 32, 32).data;
    });
    const references = { red: reference('#f34f59'), blue: reference('#3988ff') };
    const paint = key => scene.art.paint(key, { x: 0, y: 0, width: 32, height: 32 }, context => {
      context.fillStyle = '#15a340'; context.fillRect(0, 0, 32, 32);
    });
    const drawHouses = (color, buildings = houses) => buildings.forEach((building, index) =>
      scene.sprite(scene.art.building(building, 0, color), index * 64, 0));
    const inspect = (name, reference) => {
      const beforeSnapshot = { ...scene.stats }, canvas = scene.snapshot();
      const actual = canvas.getContext('2d').getImageData(0, 0, 256, 128).data;
      return { name, beforeSnapshot, stats: { ...scene.stats }, image: canvas.toDataURL(),
        houses: houses.map((_, index) => {
          let compared = 0, differences = 0;
          for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
            const source = (y * 32 + x) * 4, target = (y * 256 + index * 64 + x) * 4;
            if (reference[index][source + 3] !== 255) continue;
            compared++;
            if ([0, 1, 2].some(channel => reference[index][source + channel] !== actual[target + channel])) differences++;
          }
          return { tier: index + 1, compared, differences };
        }) };
    };
    // Register this atlas with WebGL before adding any buildings. Once uploaded,
    // CanvasSource.update() uploads immediately, so updating on the first write
    // misses every later write unless the atlas is flushed after baking finishes.
    scene.beginFrame(); scene.sprite(paint('warm'), 224, 64); scene.finishFrame();
    const warm = { ...scene.stats }, frames = [];
    for (let frame = 0; frame < 4; frame++) {
      scene.beginFrame(); scene.sprite(paint('first-write'), 224, 64);
      drawHouses('#f34f59'); scene.finishFrame();
      frames.push(inspect(frame === 0 ? 'new-houses' : `cached-${frame}`, references.red));
    }
    // Construction art and new building kinds can be introduced well after the
    // original settlement has been cached, just like house level upgrades.
    const construction = houses.map(building => ({ ...building, construction: { startedAt: -30, duration: 90 } }));
    const utilities = ['well', 'blacksmith', 'guardPost'].map((kind, index) => ({ ...houses[index], kind }));
    for (const [name, buildings] of [['construction', construction], ['new-utilities', utilities]]) {
      scene.beginFrame(); scene.sprite(paint(`first-write-${name}`), 224, 64);
      drawHouses('#f34f59', buildings); scene.finishFrame();
      frames.push(inspect(name, reference('#f34f59', buildings)));
    }
    // Snapshot is also a render entry point and must include late writes even
    // when the normal finishFrame() has not yet run.
    scene.beginFrame(); scene.sprite(paint('snapshot-first-write'), 224, 64);
    drawHouses('#3988ff');
    frames.push(inspect('snapshot-new-houses', references.blue));
    const snapshotUploads = scene.stats.textureUploads;
    scene.snapshot();
    const repeatedSnapshotUploads = scene.stats.textureUploads;
    scene.destroy();
    return { warm, frames, snapshotUploads, repeatedSnapshotUploads };
  });
  for (const frame of result.frames) {
    await writeFile(`${out}/${frame.name}.png`, Buffer.from(frame.image.split(',')[1], 'base64'));
    delete frame.image;
  }
  await writeFile(`${out}/results.json`, JSON.stringify({ ...result, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.equal(result.warm.textureUploads, 1);
  for (const frame of result.frames) {
    assert.equal(frame.stats.atlasPages, 1, `${frame.name}: houses reuse the warmed atlas`);
    for (const house of frame.houses) {
      assert.ok(house.compared > 0, `${frame.name}: tier ${house.tier} has opaque reference pixels`);
      assert.equal(house.differences, 0, `${frame.name}: tier ${house.tier} is fully visible`);
    }
    const cached = frame.name.startsWith('cached-');
    const snapshotOnly = frame.name === 'snapshot-new-houses';
    assert.equal(frame.beforeSnapshot.textureUploads, cached || snapshotOnly ? 0 : 1,
      `${frame.name}: normal rendering flushes art before snapshot extraction`);
    assert.equal(frame.stats.rasterized, cached ? 0 : 4, `${frame.name}: expected cache behavior`);
    assert.equal(frame.stats.textureUploads, cached ? 0 : 1, `${frame.name}: one upload per dirty atlas`);
  }
  assert.equal(result.repeatedSnapshotUploads, result.snapshotUploads, 'repeated snapshot does not reupload unchanged art');
  console.log(JSON.stringify({ pass: true, frames: result.frames.length,
    comparedPixels: result.frames.reduce((total, frame) => total + frame.houses.reduce((count, house) => count + house.compared, 0), 0),
    atlasUploads: result.frames.map(frame => frame.stats.textureUploads), errors }, null, 2));
} finally { await browser.close(); }
