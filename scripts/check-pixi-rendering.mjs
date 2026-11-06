import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const out = process.env.CHECK_OUT || 'scratch/native-pixi-check';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
  (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(() => { requestAnimationFrame = () => 0; });
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.assets === 'ready', null, { polling: 50, timeout: 60000 });
  const results = await page.evaluate(async () => {
    const { PixiScene } = await import('/src/game/pixi-scene.ts');
    const results = [];
    for (const dpr of [1, 2]) {
      const scene = new PixiScene(), canvas = document.createElement('canvas');
      await scene.initialize(canvas, 320, 240, dpr);
      const paint = (key, color, side = 32) => scene.art.paint(key, { x: 0, y: 0, width: side, height: side }, c => {
        c.fillStyle = color; c.fillRect(0, 0, side, side);
      });
      const draw = () => {
        scene.beginFrame();
        scene.sprite(paint('green', '#27a964'), 12, 16, 2);
        scene.sprite(paint('orange', '#e6a02e'), 100, 16);
        scene.graphics().rect(160, 16, 32, 32).fill('#5cb5d6');
        scene.finishFrame();
      };
      const pixel = (x, y) => Array.from(scene.snapshot().getContext('2d').getImageData(x * dpr, y * dpr, 1, 1).data);
      draw(); draw();
      const result = { dpr, cached: { ...scene.stats }, green: pixel(20, 24), orange: pixel(110, 24), shape: pixel(170, 24) };
      // Fog has one explicitly mutable texture; updated pixels must reach the GPU.
      const fog = document.createElement('canvas'); fog.width = fog.height = 16;
      const context = fog.getContext('2d');
      for (const color of ['red', 'blue']) {
        context.fillStyle = color; context.fillRect(0, 0, 16, 16);
        scene.beginFrame(); scene.updateFog(fog); scene.drawFog(0, 0, 16, 16); scene.finishFrame();
        result[color] = pixel(8, 8);
      }
      // Keep a clean chunk resident while an edited offscreen chunk waits to upload.
      const terrain = document.createElement('canvas'); terrain.width = 2048; terrain.height = 256;
      const ground = terrain.getContext('2d');
      ground.fillStyle = '#27a964'; ground.fillRect(0, 0, 2048, 256);
      const terrainFrame = offset => {
        scene.beginFrame(); scene.terrain(terrain, offset, 0, 1, 320, 240); scene.finishFrame();
        return { uploads: scene.stats.textureUploads, pixel: pixel(8, 8) };
      };
      terrainFrame(0); terrainFrame(-1024);
      ground.fillStyle = '#e6a02e'; ground.fillRect(1024, 0, 32, 32);
      scene.invalidateTerrain({ x: 1024, y: 0, width: 32, height: 32 });
      result.terrainClean = terrainFrame(0);
      result.terrainChanged = terrainFrame(-1024);
      result.terrainReused = terrainFrame(-1024);
      scene.resize(400, 280, dpr); draw();
      result.resized = [scene.snapshot().width, scene.snapshot().height];
      // Release a complete world, then reuse the same sprite pool and child count.
      for (let i = 0; i < 5; i++) { scene.resetWorld(); draw(); }
      result.resetGreen = pixel(20, 24);
      let maxAtlasPages = 0;
      for (let i = 0; i < 24; i++) {
        scene.beginFrame(); scene.sprite(paint(`retire-${i}`, `rgb(${i},40,80)`, 500), 0, 0); scene.finishFrame();
        maxAtlasPages = Math.max(maxAtlasPages, scene.stats.atlasPages);
      }
      result.maxAtlasPages = maxAtlasPages;
      scene.resetWorld(); draw();
      result.finalGreen = pixel(20, 24);
      result.image = scene.snapshot().toDataURL();
      results.push(result); scene.destroy();
    }
    const { Renderer } = await import('/src/game/renderer.ts');
    for (const destroyDuringInitialization of [false, true]) {
      const canvas = document.createElement('canvas'), minimap = document.createElement('canvas');
      canvas.style.width = '320px'; canvas.style.height = '240px'; document.body.append(canvas, minimap);
      const renderer = new Renderer(canvas, minimap), initialized = renderer.initialize();
      if (destroyDuringInitialization) renderer.destroy();
      await initialized; renderer.destroy(); renderer.resize();
      canvas.remove(); minimap.remove();
    }
    return results;
  });
  for (const result of results) {
    await writeFile(`${out}/native-${result.dpr}.png`, Buffer.from(result.image.split(',')[1], 'base64'));
    delete result.image;
    for (const key of ['green', 'resetGreen', 'finalGreen']) assert.deepEqual(result[key], [39, 169, 100, 255]);
    assert.deepEqual(result.orange, [230, 160, 46, 255]);
    assert.deepEqual(result.shape, [92, 181, 214, 255]);
    assert.deepEqual(result.red, [255, 0, 0, 255]);
    assert.deepEqual(result.blue, [0, 0, 255, 255]);
    assert.deepEqual(result.terrainClean, { uploads: 0, pixel: [39, 169, 100, 255] });
    assert.deepEqual(result.terrainChanged, { uploads: 1, pixel: [230, 160, 46, 255] });
    assert.deepEqual(result.terrainReused, { uploads: 0, pixel: [230, 160, 46, 255] });
    assert.deepEqual(result.resized, [400 * result.dpr, 280 * result.dpr]);
    assert.equal(result.cached.rasterized, 0);
    assert.equal(result.cached.textureUploads, 0);
    assert.equal(result.cached.rasterCacheHits, 2);
    assert.equal(result.cached.sprites, 2);
    assert.ok(result.maxAtlasPages > 1 && result.maxAtlasPages <= 9);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${out}/results.json`, JSON.stringify({ pass: true, results }, null, 2));
  console.log(JSON.stringify({ pass: true, results }, null, 2));
} finally { await browser.close(); }
