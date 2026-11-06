import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// The current HUD and action controls are covered by forged-hud-check.mjs.
// Keep this independent pixel check for farm clipping at native shore contours.
const output = 'scratch/2026-10-31-forged-hud-implementation';
mkdirSync(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { checks: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.stack || String(error)));
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && ['ready', 'error'].includes(document.documentElement.dataset.assets));
  assert.equal(await page.evaluate(() => document.documentElement.dataset.assets), 'ready');
  await page.evaluate(() => { window.__game.state.paused = true; });
  const farms = await page.evaluate(async () => {
    const { paintTerrain, rasterTerrain, clipFarmToLand } = await import('/src/game/terrain.ts');
    const { drawFarm } = await import('/src/game/sprites.ts');
    const world = { width: 6, height: 6, seed: 'shore-farm', source: 'test', spawns: [], tiles: Array.from({ length: 36 }, (_, i) => ({ terrain: i % 6 >= 3 || Math.floor(i / 6) < 2 ? 'river' : 'grassland', overlay: 'none', farm: i === 15 ? 0 : undefined, variation: .2, elevation: .4, moisture: .5, food: 1, production: 1, gold: 0 })) };
    const terrain = document.createElement('canvas');
    const render = () => {
      paintTerrain(terrain, world);
      const raster = rasterTerrain(world), c = terrain.getContext('2d');
      const before = c.getImageData(0, 0, 192, 192).data;
      c.save(); clipFarmToLand(c, terrain, 3, 2, 96, 64, 32); drawFarm(c, 96, 64, 32, 0, .2); c.restore();
      const after = c.getImageData(0, 0, 192, 192).data;
      let waterPixels = 0, changedWater = 0, changedLand = 0;
      for (let y = 64; y < 96; y++) for (let x = 96; x < 128; x++) {
        const p = (y * 192 + x) * 4;
        const changed = before[p] !== after[p] || before[p + 1] !== after[p + 1] || before[p + 2] !== after[p + 2];
        if (raster.water[Math.floor(y / 2) * raster.width + Math.floor(x / 2)]) { waterPixels++; if (changed) changedWater++; }
        else if (changed) changedLand++;
      }
      return { waterPixels, changedWater, changedLand };
    };
    const corner = render();
    world.tiles[2 * 6 + 3].terrain = 'grassland';
    const updated = render();
    return { corner, updated };
  });
  assert.ok(farms.corner.waterPixels > 0, 'fixture must include the native Puny shore inside the clipped farm area');
  assert.equal(farms.corner.changedWater, 0); assert.ok(farms.corner.changedLand > 20);
  assert.equal(farms.updated.changedWater, 0); assert.ok(farms.updated.changedLand > 20);
  report.checks.push({ name: 'farm contours preserve water before and after a shoreline update', pass: true, detail: farms });
  assert.deepEqual(report.errors, []);
  console.log('PASS farm contours preserve every water pixel, including after a shoreline update');
} catch (error) {
  report.errors.push(error.stack || String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  writeFileSync(`${output}/farm-shore-report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
