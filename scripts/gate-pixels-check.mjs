import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
const context = await browser.newContext();
const page = await context.newPage();
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5175/', { waitUntil: 'networkidle' });
  const result = await page.evaluate(async () => {
    const { drawBuilding } = await import('/src/game/sprites.ts');
    const { loadPunyWorld, punyWorldImage } = await import('/src/game/puny-world.ts');
    const { buildingConnections, gateConnections, indexBuildings } = await import('/src/game/renderer.ts');
    await loadPunyWorld();
    const atlas = punyWorldImage();
    const source = document.createElement('canvas');
    source.width = atlas.naturalWidth; source.height = atlas.naturalHeight;
    const sourceContext = source.getContext('2d');
    sourceContext.drawImage(atlas, 0, 0);
    const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
    const palette = new Set();
    for (let i = 0; i < sourcePixels.length; i += 4) if (sourcePixels[i + 3] === 255) palette.add(`${sourcePixels[i]},${sourcePixels[i + 1]},${sourcePixels[i + 2]}`);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const c = canvas.getContext('2d');
    const gallery = document.createElement('canvas');
    gallery.width = 768; gallery.height = 240;
    const g = gallery.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#85a643'; g.fillRect(0, 0, 768, 240);
    const building = (kind, x, y) => ({ id: 1, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    const wall = building('wall', 2, 2), road = building('road', 2, 2);
    const directions = ['north', 'east', 'south', 'west'];
    const offsets = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const checks = [5, 10, 3, 15].map((mask, i) => {
      const links = Object.fromEntries(directions.map((side, bit) => [side, !!(mask & (1 << bit))]));
      const pieces = [wall, road, ...offsets.map(([dx, dy]) => building('wall', 2 + dx, 2 + dy)),
        ...offsets.filter((_, bit) => mask & (1 << bit)).map(([dx, dy]) => building('road', 2 + dx, 2 + dy))];
      const index = indexBuildings(pieces);
      const walls = buildingConnections(wall, index), gate = gateConnections(wall, index);
      c.clearRect(0, 0, 32, 32);
      drawBuilding(c, wall, 0, 0, 32, 0, '#3988ff', walls, gate);
      const pixels = c.getImageData(0, 0, 32, 32).data;
      const alpha = (x, y) => pixels[(y * 32 + x) * 4 + 3];
      let blockedPassagePixels = 0;
      let assetPixels = 0, foreignPixels = 0;
      for (let p = 0; p < pixels.length; p += 4) if (pixels[p + 3]) {
        assetPixels++;
        if (pixels[p + 3] !== 255 || !palette.has(`${pixels[p]},${pixels[p + 1]},${pixels[p + 2]}`)) foreignPixels++;
      }
      for (let y = 11; y <= 20; y++) for (let x = 11; x <= 20; x++) if (alpha(x, y)) blockedPassagePixels++;
      directions.forEach((side, bit) => {
        if (!(mask & (1 << bit))) return;
        for (let across = 11; across <= 20; across++) for (let along = 0; along < 32; along++) {
          const x = side === 'north' || side === 'south' ? across : along;
          const y = side === 'north' || side === 'south' ? along : across;
          if ((side === 'north' && y <= 16 || side === 'south' && y >= 16 || side === 'west' && x <= 16 || side === 'east' && x >= 16) && alpha(x, y)) blockedPassagePixels++;
        }
      });
      const forward = canvas.toDataURL();
      c.clearRect(0, 0, 32, 32);
      const reversed = indexBuildings([...pieces].reverse());
      drawBuilding(c, wall, 0, 0, 32, 0, '#3988ff', buildingConnections(wall, reversed), gateConnections(wall, reversed));
      const orderIndependent = canvas.toDataURL() === forward;
      const x = i * 192;
      g.fillStyle = '#203224'; g.font = '14px monospace';
      g.fillText(['N–S gate', 'E–W gate', 'Corner gate', 'Crossing gate'][i], x + 12, 20);
      drawBuilding(g, road, x + 32, 45, 128, 0, '#3988ff', links);
      drawBuilding(g, wall, x + 32, 45, 128, 0, '#3988ff', walls, gate);
      g.fillText('road beneath wall', x + 12, 210);
      return { mask, blockedPassagePixels, orderIndependent, assetPixels, foreignPixels };
    });
    c.clearRect(0, 0, 32, 32);
    drawBuilding(c, wall, 0, 0, 32, 0, '#3988ff');
    const solidWallCenter = c.getImageData(16, 16, 1, 1).data[3];
    return { checks, solidWallCenter, image: gallery.toDataURL() };
  });
  for (const check of result.checks) {
    assert.equal(check.blockedPassagePixels, 0, `Gate mask ${check.mask}: masonry and shadows must leave the road passage clear`);
    assert.equal(check.orderIndependent, true, `Gate mask ${check.mask}: placement order must not change gate artwork`);
    assert.ok(check.assetPixels > 0, `Gate mask ${check.mask}: visible native wall pieces remain`);
    assert.equal(check.foreignPixels, 0, `Gate mask ${check.mask}: all wall colors must come from Puny World`);
  }
  assert.equal(result.solidWallCenter, 255, 'A wall without a road stays solid');
  mkdirSync('output', { recursive: true });
  writeFileSync('output/btv-gate-pixels.png', Buffer.from(result.image.split(',')[1], 'base64'));
  console.log('PASS Puny World wall pixels, gate openings, corners, crossings, placement-order independence, and solid walls');
} finally { await context.close(); await browser.close(); }
