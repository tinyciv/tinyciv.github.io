import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const alps = process.argv.includes('--alps');
const seed = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'MED-200BC';
const stem = alps ? 'mediterranean-alps' : 'mediterranean-full-map';
const review = alps ? 'scratch/2026-11-05-alps-waterfalls' : 'scratch/2026-11-04-mediterranean-full-map';
await mkdir(review, { recursive: true });
await mkdir('output', { recursive: true });

// Use the game's actual generation, terrain, ford and vegetation renderers.
// The exported image is a complete map at the original 16px sprite resolution.
const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
  import { generateWorld, normalizePunyWorld } from './src/world/generator';
  import { rasterTerrain, drawAnimatedWater } from './src/game/terrain';
  import { loadPunyWorld, punyWorldImage } from './src/game/puny-world';
  import { loadVegetationArt, drawVegetation } from './src/game/vegetation-art';
  import { drawFordStones, fordCrossingAxis } from './src/game/ford-art';
  window.__mapExport = (async () => {
    await Promise.all([loadPunyWorld(), loadVegetationArt()]);
    const world = generateWorld(${JSON.stringify(seed)}, undefined, undefined, { style: 'mediterranean' });
    normalizePunyWorld(world);
    const regional = ${alps};
    const x0 = regional ? Math.floor(17 / 54 * world.width) : 0;
    const y0 = regional ? Math.floor(1 / 22 * world.height) : 0;
    const x1 = regional ? Math.ceil(29 / 54 * world.width) : world.width;
    const y1 = regional ? Math.ceil(5.5 / 22 * world.height) : world.height;
    const region = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    const raster = rasterTerrain(world, region), selected = [], waterfalls = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const tile = world.tiles[y * world.width + x]; selected.push(tile);
      if (tile.waterfall) waterfalls.push({ x: x - x0, y: y - y0, fromTier: tile.ridgeTier ?? 1,
        toTier: world.tiles[(y + 1) * world.width + x].ridgeTier ?? 0 });
    }
    if (regional && !waterfalls.length) throw new Error('The regenerated Alps contain no waterfalls.');
    const canvas = document.createElement('canvas'); canvas.width = raster.width; canvas.height = raster.height;
    const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false;
    const pixels = c.createImageData(raster.width, raster.height); pixels.data.set(raster.pixels);
    const groundFrames = [], sceneFrames = [];
    for (let frame = 0; frame < (regional ? 4 : 1); frame++) {
      c.putImageData(pixels, 0, 0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const tile = world.tiles[y * world.width + x], px = (x - x0) * 16, py = (y - y0) * 16;
        if (regional && tile.waterfall) drawAnimatedWater(c, world, x, y, px, py, 16, frame * .1 + .001);
        if (tile.overlay === 'ford') drawFordStones(c, punyWorldImage(), px, py, 16, fordCrossingAxis(world, x, y), tile.variation);
      }
      groundFrames.push(canvas.toDataURL('image/png'));
      // Include overhanging plants rooted just outside the cropped viewport.
      for (let y = Math.max(0, y0 - 2); y < Math.min(world.height, y1 + 3); y++)
        for (let x = Math.max(0, x0 - 2); x < Math.min(world.width, x1 + 2); x++)
          drawVegetation(c, world.tiles[y * world.width + x], (x - x0) * 16, (y - y0) * 16, 16);
      sceneFrames.push(canvas.toDataURL('image/png'));
    }
    const starts = [...world.spawns.map((p, i) => ({ ...p, label: String(i + 1), capital: true })),
      ...(world.secondarySpawns ?? []).map((p, i) => ({ ...p, label: String(i + 2), capital: false }))]
      .filter(p => p.x >= x0 && p.x < x1 && p.y >= y0 && p.y < y1).map(p => ({ ...p, x: p.x - x0, y: p.y - y0 }));
    return { width: canvas.width, height: canvas.height, tilesWide: region.width, tilesHigh: region.height, seed: world.seed,
      ground: groundFrames[0], scene: sceneFrames[0],
      bounds: { west: -12 + x0 / world.width * 54, east: -12 + x1 / world.width * 54,
        north: 49 - y0 / world.height * 22, south: 49 - y1 / world.height * 22 }, starts,
      ...(regional ? { title: 'Alps • c.200 BC', subtitle: 'Mountain rivers and waterfalls', name: 'alps',
        sceneFrames, groundFrames, frameSeconds: .1, waterfalls } : {}),
      metrics: { rivers: selected.filter(t => t.terrain === 'river').length,
        creeks: selected.filter(t => t.creek).length, forest: selected.filter(t => t.overlay === 'forest').length,
        waterfalls: waterfalls.length,
        tiers: [1,2,3,4,5].map(tier => selected.filter(t => t.ridge && (t.ridgeTier ?? 1) === tier).length) } };
  })();
` }, bundle: true, write: false, format: 'iife', target: 'es2022', define: { 'import.meta.env.BASE_URL': '"/"' } });
const bundle = result.outputFiles[0].text;
await writeFile(`${review}/export-renderer.js`, bundle);
const assetsRoot = resolve('public/assets');
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><meta charset="utf-8"><title>Map export</title><script src="/export.js"></script>');
    } else if (pathname === '/export.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(bundle);
    } else {
      const path = resolve('public', `.${decodeURIComponent(pathname)}`);
      if (!path.startsWith(assetsRoot + sep)) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': path.endsWith('.png') ? 'image/png' : 'application/octet-stream' });
      response.end(await readFile(path));
    }
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
    (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
  const data = await page.evaluate(() => window.__mapExport);
  if (errors.length) throw new Error(errors.join('\n'));
  for (const [name, image] of [[stem, data.scene], [alps ? 'mediterranean-alps-ground' : 'mediterranean-ground', data.ground]])
    await writeFile(`output/${name}.png`, Buffer.from(image.split(',')[1], 'base64'));
  const font = `data:font/ttf;base64,${(await readFile('public/assets/fonts/pixel-operator/PixelOperator.ttf')).toString('base64')}`;
  const html = (await readFile('dev/mediterranean-map/viewer.html', 'utf8'))
    .replace('/*PIXEL_FONT*/', () => font)
    .replace('/*MAP_DATA*/', () => JSON.stringify(data).replaceAll('<', '\\u003c'));
  if (html.includes('/*MAP_DATA*/') || html.includes('/*PIXEL_FONT*/')) throw new Error('Unresolved viewer placeholder.');
  await writeFile(`output/${stem}.html`, html);
  const { scene, ground, sceneFrames, groundFrames, ...metadata } = data;
  await writeFile(`${review}/map-metadata.json`, JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify({ file: `output/${stem}.html`, png: `output/${stem}.png`,
    dimensions: [data.width, data.height], seed: data.seed, htmlMB: +(Buffer.byteLength(html) / 1024 / 1024).toFixed(2), metrics: data.metrics }, null, 2));
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
