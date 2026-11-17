import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const [sourceFile, outputFile, styleValue] = process.argv.slice(2);
const style = Number(styleValue);
const catalog = JSON.parse(await readFile(new URL('../../src/game/relief-shapes.json', import.meta.url), 'utf8'));
const cells = catalog[style];
if (!sourceFile || !outputFile || !cells) throw new Error('Usage: node tools/runtime-art/relief.mjs source.png output.png style');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });
try {
  const page = await browser.newPage();
  const data = await readFile(sourceFile);
  // Match reliefImage's existing Canvas sampling and alpha cutoff exactly.
  // Layout/source geometry remains in relief-shapes.json; only raster data is baked.
  const encoded = await page.evaluate(async ({ data, cells, style }) => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const frames = cells.map(cell => {
      const width = cell.nativeWidth ?? [32, 48, 64][style];
      return { width, height: Math.max(2, Math.round(width * cell.height / cell.width)) };
    });
    const atlas = document.createElement('canvas');
    atlas.width = Math.max(...frames.map(frame => frame.width));
    atlas.height = frames.reduce((height, frame) => height + frame.height, 0);
    const atlasContext = atlas.getContext('2d'); let top = 0;
    for (let slot = 0; slot < cells.length; slot++) {
      const cell = cells[slot], { width, height } = frames[slot];
      const frame = document.createElement('canvas'); frame.width = width; frame.height = height;
      const context = frame.getContext('2d', { willReadFrequently: true }); context.imageSmoothingEnabled = false;
      context.drawImage(image, cell.x, cell.y, cell.width, cell.height, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = pixels.data[i] >= 192 ? 255 : 0;
      context.putImageData(pixels, 0, 0);
      atlasContext.drawImage(frame, 0, top); top += height;
    }
    return atlas.toDataURL('image/png').split(',')[1];
  }, { data: data.toString('base64'), cells, style });
  await writeFile(outputFile, Buffer.from(encoded, 'base64'));
} finally { await browser.close(); }
