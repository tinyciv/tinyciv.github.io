import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

// Import authored Imagegen studies into exact native pixel grids. Originals
// remain unchanged; all output stays in the comparison artifact directory.
const root = path.resolve('output/art-resolution-study');
const audit = JSON.parse(await fs.readFile(path.join(root, 'audit.json'), 'utf8'));
const input = {};
for (const name of ['houses', 'tower', 'palace', 'grain'])
  input[name] = 'data:image/png;base64,' + (await fs.readFile(path.join(root, 'sources', name + '.png'))).toString('base64');
const names = ['house-shack', 'house-hovel', 'house-cottage', 'house-villa', 'wooden-tower', 'palace', 'farm-bare', 'fence-horizontal', 'fence-vertical', 'fence-post'];
for (let i = 0; i < 6; i++) names.push('farm-mature-' + i, 'farm-green-' + i);
for (const name of names)
  input['current-' + name] = 'data:image/png;base64,' + (await fs.readFile(path.join(root, 'current', name + '.png'))).toString('base64');

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let result;
try {
  const page = await browser.newPage();
  result = await page.evaluate(async ({ input, wood, soil }) => {
    const images = {};
    await Promise.all(Object.entries(input).map(async ([key, src]) => {
      const image = new Image(); image.src = src; await image.decode(); images[key] = image;
    }));
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const grain = ['#232e22', '#2f432a', '#4e6d35', '#778c3e', '#8a7c3f', '#adbc3d', '#bfa754', '#f1d068'];
    // Three blue banner tones retain the existing faction identity.
    const banner = ['#18396b', '#2e6ecd', '#3e94ff'];
    const make = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').imageSmoothingEnabled = false; return c; };
    const pixels = image => { const c = make(image.width, image.height); c.getContext('2d').drawImage(image, 0, 0); return c.getContext('2d').getImageData(0, 0, c.width, c.height); };
    const bounds = (image, region = [0, 0, image.width, image.height]) => {
      const [x, y, w, h] = region, data = pixels(image).data; let l = x + w, t = y + h, r = -1, b = -1;
      for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) if (data[(py * image.width + px) * 4 + 3] >= 128) {
        l = Math.min(l, px); t = Math.min(t, py); r = Math.max(r, px); b = Math.max(b, py);
      }
      if (r < l) throw new Error('Empty source crop');
      return [l, t, r - l + 1, b - t + 1];
    };
    const quantize = (canvas, palette) => {
      const c = canvas.getContext('2d'), image = c.getImageData(0, 0, canvas.width, canvas.height), p = image.data, colors = palette?.map(rgb);
      for (let i = 0; i < p.length; i += 4) {
        if (p[i + 3] < 128) { p[i] = p[i + 1] = p[i + 2] = p[i + 3] = 0; continue; }
        p[i + 3] = 255;
        if (colors) {
          let best = colors[0], score = Infinity;
          for (const color of colors) {
            const distance = 2 * (p[i] - color[0]) ** 2 + 4 * (p[i + 1] - color[1]) ** 2 + 3 * (p[i + 2] - color[2]) ** 2;
            if (distance < score) { score = distance; best = color; }
          }
          p[i] = best[0]; p[i + 1] = best[1]; p[i + 2] = best[2];
        }
      }
      c.putImageData(image, 0, 0); return canvas;
    };
    const stats = canvas => {
      const p = pixels(canvas).data, colors = new Set(), alpha = new Set();
      let l = canvas.width, t = canvas.height, r = -1, b = -1;
      for (let i = 0; i < p.length; i += 4) {
        alpha.add(p[i + 3]); if (p[i + 3] < 128) continue;
        colors.add((p[i] << 16) | (p[i + 1] << 8) | p[i + 2]);
        const x = i / 4 % canvas.width, y = Math.floor(i / 4 / canvas.width);
        l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); b = Math.max(b, y);
      }
      return { colors: colors.size, alphaValues: [...alpha].sort((a, b) => a - b), alphaBounds: r >= l ? [l, t, r - l + 1, b - t + 1] : null };
    };
    const files = [], imports = [], assets = [];
    const save = (canvas, name, frameWidth = canvas.width, frames = 1, fps = 1) => {
      files.push({ path: name, data: canvas.toDataURL().split(',')[1] });
      return { path: 'output/art-resolution-study/' + name, width: canvas.width, height: canvas.height, frameWidth, frameHeight: canvas.height, frames, fps, ...stats(canvas) };
    };
    const resize = (image, w, h) => { const c = make(w, h); c.getContext('2d').drawImage(image, 0, 0, w, h); return c; };
    const cropInto = (image, crop, w, h, target) => { const c = make(w, h); c.getContext('2d').drawImage(image, ...crop, ...target); return c; };
    const sheet = frames => { const c = make(frames[0].width * frames.length, frames[0].height); frames.forEach((f, i) => c.getContext('2d').drawImage(f, i * f.width, 0)); return c; };
    const houseCrops = ['shack', 'hovel', 'cottage', 'villa'].map((_, i) => {
      const im = images.houses, x = Math.round(i % 2 * im.width / 2), y = Math.round(Math.floor(i / 2) * im.height / 2);
      return bounds(im, [x, y, Math.round((i % 2 + 1) * im.width / 2) - x, Math.round((Math.floor(i / 2) + 1) * im.height / 2) - y]);
    });
    for (const [index, tier] of ['shack', 'hovel', 'cottage', 'villa'].entries()) {
      const id = 'house-' + tier, current = images['current-' + id];
      const item = { id, kind: 'house', name: tier[0].toUpperCase() + tier.slice(1), tier, footprint: [1, 1], world: { width: 32, height: 32, offsetY: 0, shrink: .9 }, variants: {}, resolutionOnly: {} };
      item.variants.current = { path: 'output/art-resolution-study/current/' + id + '.png', width: 64, height: 64, frameWidth: 64, frameHeight: 64, frames: 1, fps: 1, ...stats(current) };
      for (const n of [16, 24, 32]) {
        // Equal normalized box at every resolution; source widths never change the world footprint.
        const target = [n / 16, n / 8, n * 14 / 16, n * 13 / 16];
        const candidate = quantize(cropInto(images.houses, houseCrops[index], n, n, target), wood);
        item.variants['p' + n] = save(candidate, 'native/p' + n + '/' + id + '.png');
        item.resolutionOnly['p' + n] = save(quantize(resize(current, n, n)), 'resolution-only/p' + n + '/' + id + '.png');
      }
      imports.push({ id, source: 'sources/houses.png', rect: houseCrops[index], targetAt16: [1, 2, 14, 13], palette: 'wood16' }); assets.push(item);
    }
    for (const id of ['wooden-tower', 'palace']) {
      const tower = id === 'wooden-tower', source = images[tower ? 'tower' : 'palace'], crop = bounds(source), current = images['current-' + id];
      const item = { id, kind: tower ? 'tower' : 'palace', name: tower ? 'Wooden guard tower' : 'Timber palace', footprint: tower ? [1, 1] : [2, 2], world: { width: tower ? 32 : 64, height: tower ? 56 : 64, offsetY: tower ? -24 : 0, shrink: tower ? .9 : 1 }, variants: {}, resolutionOnly: {} };
      item.variants.current = { path: 'output/art-resolution-study/current/' + id + '.png', width: current.width, height: current.height, frameWidth: current.width, frameHeight: current.height, frames: 1, fps: 1, ...stats(current) };
      for (const n of [16, 24, 32]) {
        const w = n * (tower ? 1 : 2), h = n * (tower ? 1.75 : 2);
        // Tower matches the previous45world-pixel opaque height. Palace keeps its full2×2canvas.
        const targetW = tower ? n * .75 : w, targetH = tower ? n * 25 / 16 : Math.round(crop[3] / crop[2] * w);
        const target = [(w - targetW) / 2, (tower ? n * 27 / 16 : h) - targetH, targetW, targetH];
        item.variants['p' + n] = save(quantize(cropInto(source, crop, w, h, target), tower ? wood : [...wood, ...banner]), 'native/p' + n + '/' + id + '.png');
        item.resolutionOnly['p' + n] = save(quantize(resize(current, w, h)), 'resolution-only/p' + n + '/' + id + '.png');
      }
      imports.push({ id, source: 'sources/' + (tower ? 'tower' : 'palace') + '.png', rect: crop, palette: tower ? 'wood16' : 'wood16+banner3' }); assets.push(item);
    }
    const rows = [[80, 293], [295, 480], [482, 659], [660, 831]], columns = [ [[100, 280], [285, 450], [455, 625], [628, 808]], [[980, 1150], [1150, 1331], [1340, 1505], [1505, 1685]] ];
    for (const [stateIndex, state] of ['green', 'ripe'].entries()) {
      const id = 'grain-' + state, currentPrefix = state === 'ripe' ? 'farm-mature-' : 'farm-green-';
      const currentFrames = Array.from({ length: 6 }, (_, i) => resize(images['current-' + currentPrefix + i], 64, 64));
      const fps = 6 / (Math.PI * 2 / 1.65);
      const item = { id, kind: 'farm', name: state === 'ripe' ? 'Ripe grain farm' : 'Green grain farm', footprint: [1, 1], world: { width: 32, height: 32, offsetY: 0, shrink: 1 }, variants: {}, resolutionOnly: {}, notes: 'One plot; fences shared by the whole 3×3 enclosure. Simplified study uses four clear planting rows instead of six dense rows; the existing soil remains.' };
      item.variants.current = save(sheet(currentFrames), 'current/' + id + '.png', 64, 6, fps);
      const crops = rows.flatMap(([top, bottom]) => columns[stateIndex].map(([left, right]) => bounds(images.grain, [left, top, right - left, bottom - top])));
      for (const n of [16, 24, 32]) {
        const frames = [], overlays = [];
        for (let frame = 0; frame < 6; frame++) {
          const layer = make(n, n), c = layer.getContext('2d');
          for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
            const [sx, sy, sw, sh] = crops[row * 4 + col], width = n * .19, height = n * (state === 'green' ? .18 : .21), left = n * (.025 + col * .25), bottom = n * (.25 + row * .24), split = height * .3;
            const phase = frame / 6 * Math.PI * 2 + row * .62 + col * .21;
            const sway = Math.round(Math.sin(phase) * Math.max(1, n / 32));
            c.drawImage(images.grain, sx, sy + sh * .7, sw, sh * .3, left, bottom - split, width, split);
            c.drawImage(images.grain, sx, sy, sw, sh * .7, Math.max(0, Math.min(n - width, left + sway)), bottom - height, width, height - split);
          }
          quantize(layer, grain); overlays.push(layer);
          const full = quantize(resize(images['current-farm-bare'], n, n)); full.getContext('2d').drawImage(layer, 0, 0); frames.push(full);
        }
        item.variants['p' + n] = save(sheet(frames), 'native/p' + n + '/' + id + '.png', n, 6, fps);
        item.variants['p' + n].overlay = save(sheet(overlays), 'native/p' + n + '/' + id + '-overlay.png', n, 6, fps);
        item.resolutionOnly['p' + n] = save(sheet(currentFrames.map(f => quantize(resize(f, n, n)))), 'resolution-only/p' + n + '/' + id + '.png', n, 6, fps);
      }
      imports.push({ id, source: 'sources/grain.png', tuftRects: crops, rows: 4, columns: 4, palette: 'grain8', fixedSoilPalette: soil, frames: 6, fps }); assets.push(item);
    }
    return { files, assets, imports, palettes: { wood16: wood, grain8: grain, banner3: banner, currentSoil: soil } };
  }, { input, wood: audit.palettes.wood16.map(p => p.hex), soil: audit.palettes.currentSoil });
} finally { await browser.close(); }
for (const file of result.files) {
  const output = path.join(root, file.path); await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, Buffer.from(file.data, 'base64'));
}
const manifest = {
  title: 'A shared pixel language',
  description: 'House, guard tower, grain farm and palace at 16, 24 and 32 source pixels per world cell, compared with current production art against unchanged Puny terrain and units.',
  scope: 'Comparison assets only. No game renderer, production assets, placement or gameplay changed.',
  created: '2026-10-26', logicalCellSize: 32, defaultGameZoom: 1.35,
  auditPath: 'output/art-resolution-study/audit.json',
  references: {
    atlas: { path: 'public/assets/puny-world/overworld.png', width: 432, height: 1040 },
    units: Object.fromEntries([['leader', 'Warrior-Blue.png'], ['worker', 'Human-Worker-Cyan.png'], ['warrior', 'Human-Soldier-Cyan.png']].map(([role, name]) => [role, { path: 'public/assets/puny-world/characters/' + name, width: 768, height: 256, frameWidth: 32, frameHeight: 32, walkFrames: role === 'leader' ? [1, 2, 3] : [1, 2, 3, 4], fps: 9, drawWidth: 44.8, drawHeight: 44.8 }])),
    fences: Object.fromEntries(['horizontal', 'vertical', 'post'].map(part => [part, { path: 'output/art-resolution-study/current/fence-' + part + '.png' }])),
    crops: audit.references.map(({ id, label, rect }) => ({ id, label, rect })),
  },
  options: [
    { id: 'current', label: 'Current game art', pixelsPerCell: null, description: 'Production assets at their current detail density; houses/tower/grain 64px per cell, palace 32px per cell.' },
    { id: 'p16', label: '16px · native match', pixelsPerCell: 16, recommended: true, description: 'Matches the terrain source grid. Broad shapes; strongest fit with the original Puny tiles.' },
    { id: 'p24', label: '24px · middle ground', pixelsPerCell: 24, description: 'Keeps more roof and grain detail. The 32/24 display ratio gives uneven pixel steps at some zooms.' },
    { id: 'p32', label: '32px · detailed', pixelsPerCell: 32, description: 'One source pixel per logical game pixel before the existing 0.9 building shrink. Sharper detail, finer than terrain.' },
  ],
  treatments: [
    { id: 'matched', label: 'Simplified + native palette', description: 'Imagegen style studies with simpler masses, exact native-sized imports and a 16-color original-derived wood palette. Grain uses 8 native crop colors; existing soil is retained. Palace adds 3 blue banner colors.' },
    { id: 'resolutionOnly', label: 'Resolution only', description: 'Current designs and colors, resampled with nearest-neighbor to isolate the effect of pixel density. No redesign or palette restriction.' },
  ],
  import: { sampler: 'nearest-neighbor', alphaCutoff: 128, dithering: false, paletteMapping: 'Nearest weighted RGB distance, same palette at every resolution.', originals: 'output/art-resolution-study/sources/', prompts: 'output/art-resolution-study/prompts.json', crops: result.imports },
  palettes: result.palettes, assets: result.assets.map(asset => ({ ...asset, sourcePath: 'output/art-resolution-study/sources/' + ({ house: 'houses', tower: 'tower', palace: 'palace', farm: 'grain' }[asset.kind]) + '.png' })),
};
await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${result.files.length} PNG exports for ${result.assets.length} assets; production files untouched.`);
