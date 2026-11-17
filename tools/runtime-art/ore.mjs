import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const nativeSizes = [[16, 16], [32, 32], [48, 32]];
const [sourceFile, outputFile, familyValue] = process.argv.slice(2);
const family = Number(familyValue);
if (!sourceFile || !outputFile || !Number.isInteger(family) || !nativeSizes[family])
  throw new Error('Usage: node tools/runtime-art/ore.mjs source.png output.png family');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(chrome) ? chrome : undefined) });

try {
  // An empty document provides the same Canvas rasterizer as the game. No game
  // modules, simulation, server, or external resources participate in the bake.
  const page = await browser.newPage();
  const source = await readFile(path.resolve(sourceFile));
  const [width, height] = nativeSizes[family];
  const encoded = await page.evaluate(async ({ data, width, height }) => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const source = document.createElement('canvas');
    source.width = image.width; source.height = image.height;
    const context = source.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const atlas = document.createElement('canvas'); atlas.width = width * 3; atlas.height = height * 2;
    const atlasContext = atlas.getContext('2d');
    for (let slot = 0; slot < 6; slot++) {
      const sx = Math.round(slot % 3 * image.width / 3), sy = Math.round(Math.floor(slot / 3) * image.height / 2);
      const ex = Math.round((slot % 3 + 1) * image.width / 3), ey = Math.round((Math.floor(slot / 3) + 1) * image.height / 2);
      let x = ex, y = ey, right = sx, bottom = sy;
      for (let yy = sy; yy < ey; yy++) for (let xx = sx; xx < ex; xx++) if (pixels[(yy * image.width + xx) * 4 + 3] >= 224) {
        x = Math.min(x, xx); y = Math.min(y, yy); right = Math.max(right, xx); bottom = Math.max(bottom, yy);
      }
      if (x > right) throw new Error(`Empty ore sprite ${slot}`);
      const frame = document.createElement('canvas'); frame.width = width; frame.height = height;
      const frameContext = frame.getContext('2d', { willReadFrequently: true });
      frameContext.imageSmoothingEnabled = false;
      const sw = right - x + 1, sh = bottom - y + 1;
      const drawWidth = Math.min(width - 2, (height - 2) * sw / sh), drawHeight = Math.round(drawWidth * sh / sw);
      frameContext.drawImage(image, x, y, sw, sh, Math.round((width - drawWidth) / 2), height - 1 - drawHeight, Math.round(drawWidth), drawHeight);
      const result = frameContext.getImageData(0, 0, width, height);
      for (let i = 3; i < result.data.length; i += 4) result.data[i] = result.data[i] >= 224 ? 255 : 0;
      frameContext.putImageData(result, 0, 0);
      atlasContext.drawImage(frame, slot % 3 * width, Math.floor(slot / 3) * height);
    }
    return atlas.toDataURL('image/png').split(',')[1];
  }, { data: source.toString('base64'), width, height });
  const output = path.resolve(outputFile);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(encoded, 'base64'));
  console.log(`${output}: ${width * 3}x${height * 2}`);
} finally {
  await browser.close();
}
