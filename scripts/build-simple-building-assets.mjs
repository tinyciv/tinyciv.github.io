import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

// Import the new, independently authored silhouettes. Never overwrite masters
// or production artwork. A missing master fails before any export is written.
const root = path.resolve('output/simple-building-study');
const sources = ['house-shack', 'house-hovel', 'house-cottage', 'house-villa', 'wooden-tower', 'palace', 'grain'];
const input = {}, sourceRecords = {};
for (const id of sources) {
  const relativePath = `output/simple-building-study/sources/${id}.png`;
  const bytes = await fs.readFile(relativePath);
  input[id] = `data:image/png;base64,${bytes.toString('base64')}`;
  sourceRecords[id] = { path: relativePath, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const wood = ['#513f1b', '#67512a', '#775c1f', '#a0823f', '#b8902f', '#dcb04f', '#e9bc59', '#f6c763'];
const grain = ['#232e22', '#4e6d35', '#778c3e', '#8a7c3f', '#f1d068'];
const definitions = [
  { id: 'house-shack', name: 'Shack', kind: 'house', tier: 'shack', silhouette: 'Low lean-to', canvas: [16, 16], maxContent: [14, 8], baseline: 15 },
  { id: 'house-hovel', name: 'Hovel', kind: 'house', tier: 'hovel', silhouette: 'Round hut', canvas: [16, 16], maxContent: [10, 11], baseline: 15 },
  { id: 'house-cottage', name: 'Cottage', kind: 'house', tier: 'cottage', silhouette: 'Compact box and gable', canvas: [16, 16], maxContent: [12, 12], baseline: 15 },
  { id: 'house-villa', name: 'Villa', kind: 'house', tier: 'villa', silhouette: 'L-shaped plan with an open notch', canvas: [16, 16], maxContent: [14, 13], baseline: 15 },
  { id: 'wooden-tower', name: 'Guard tower', kind: 'tower', silhouette: 'Simple raised platform', canvas: [16, 28], maxContent: [14, 24], baseline: 27 },
  { id: 'palace', name: 'Palace', kind: 'palace', silhouette: 'One broad longhall', canvas: [32, 32], maxContent: [30, 22], baseline: 31 },
  { id: 'grain-green', name: 'Green grain', kind: 'farm', sourceId: 'grain', sourceHalf: 0, silhouette: 'Three sparse planting rows', canvas: [16, 16], maxContent: [14, 13], baseline: 15 },
  { id: 'grain-ripe', name: 'Ripe grain', kind: 'farm', sourceId: 'grain', sourceHalf: 1, silhouette: 'Three sparse planting rows', canvas: [16, 16], maxContent: [14, 13], baseline: 15 },
];

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let result;
try {
  const page = await browser.newPage();
  result = await page.evaluate(async ({ input, wood, grain, definitions }) => {
    const images = {};
    await Promise.all(Object.entries(input).map(async ([id, source]) => {
      const image = new Image(); image.src = source; await image.decode(); images[id] = image;
    }));
    const make = (width, height) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d').imageSmoothingEnabled = false;
      return canvas;
    };
    const raw = image => {
      const canvas = make(image.width, image.height), c = canvas.getContext('2d');
      c.drawImage(image, 0, 0); return c.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const sourcePixels = Object.fromEntries(Object.entries(images).map(([id, image]) => [id, raw(image)]));
    const cropBounds = (id, region) => {
      const image = images[id], pixels = sourcePixels[id];
      const [x, y, width, height] = region;
      let left = x + width, top = y + height, right = -1, bottom = -1;
      for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) {
        if (pixels[(py * image.width + px) * 4 + 3] < 128) continue;
        left = Math.min(left, px); top = Math.min(top, py);
        right = Math.max(right, px); bottom = Math.max(bottom, py);
      }
      if (right < left) throw new Error(`Empty authored silhouette: ${id}.`);
      return [left, top, right - left + 1, bottom - top + 1];
    };
    const quantize = (canvas, palette) => {
      const c = canvas.getContext('2d'), image = c.getImageData(0, 0, canvas.width, canvas.height), p = image.data;
      const colors = palette.map(hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)));
      for (let i = 0; i < p.length; i += 4) {
        if (p[i + 3] < 128) { p[i] = p[i + 1] = p[i + 2] = p[i + 3] = 0; continue; }
        let nearest = colors[0], best = Infinity;
        for (const color of colors) {
          const distance = 2 * (p[i] - color[0]) ** 2 + 4 * (p[i + 1] - color[1]) ** 2 + 3 * (p[i + 2] - color[2]) ** 2;
          if (distance < best) { best = distance; nearest = color; }
        }
        p[i] = nearest[0]; p[i + 1] = nearest[1]; p[i + 2] = nearest[2]; p[i + 3] = 255;
      }
      c.putImageData(image, 0, 0);
    };
    const stats = canvas => {
      const p = raw(canvas), colors = new Set(), alphaValues = new Set(), rows = [];
      let left = canvas.width, top = canvas.height, right = -1, bottom = -1, opaquePixels = 0;
      for (let y = 0; y < canvas.height; y++) {
        let row = '';
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4, opaque = p[i + 3] === 255;
          alphaValues.add(p[i + 3]); row += opaque ? '#' : '.';
          if (!opaque) continue;
          opaquePixels++; colors.add(`${p[i]},${p[i + 1]},${p[i + 2]}`);
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
        rows.push(row);
      }
      if (!opaquePixels) throw new Error('Import produced an empty native sprite.');
      const bounds = [left, top, right - left + 1, bottom - top + 1];
      // These measurements assist manual silhouette QA; they do not modify art.
      const cornerVoid = (fromRight, fromBottom) => {
        let best = { width: 0, height: 0, area: 0 };
        for (let w = 1; w <= Math.floor(bounds[2] / 2); w++) for (let h = 1; h <= Math.floor(bounds[3] / 2); h++) {
          let empty = true;
          for (let dy = 0; dy < h && empty; dy++) for (let dx = 0; dx < w; dx++) {
            const x = fromRight ? right - dx : left + dx, y = fromBottom ? bottom - dy : top + dy;
            if (p[(y * canvas.width + x) * 4 + 3]) { empty = false; break; }
          }
          if (empty && w * h > best.area) best = { width: w, height: h, area: w * h };
        }
        return best;
      };
      return { colors: colors.size, alphaValues: [...alphaValues].sort((a, b) => a - b),
        alphaBounds: bounds, bounds, opaquePixels, fillFraction: opaquePixels / (canvas.width * canvas.height),
        silhouetteRows: rows, cornerVoids: { topLeft: cornerVoid(false, false), topRight: cornerVoid(true, false),
          bottomLeft: cornerVoid(false, true), bottomRight: cornerVoid(true, true) } };
    };
    const files = [], assets = [], imports = [], native16 = new Map();
    for (const definition of definitions) {
      const sourceId = definition.sourceId ?? definition.id, image = images[sourceId];
      const half = Math.floor(image.width / 2);
      const region = definition.sourceHalf === undefined ? [0, 0, image.width, image.height]
        : definition.sourceHalf === 0 ? [0, 0, half, image.height] : [half, 0, image.width - half, image.height];
      const crop = cropBounds(sourceId, region), palette = definition.kind === 'farm' ? grain : wood;
      const tower = definition.kind === 'tower', palace = definition.kind === 'palace';
      const asset = { id: definition.id, name: definition.name, kind: definition.kind, tier: definition.tier,
        silhouette: definition.silhouette, footprint: palace ? [2, 2] : [1, 1],
        world: { width: palace ? 64 : 32, height: tower ? 56 : palace ? 64 : 32, offsetY: tower ? -24 : 0, shrink: tower || definition.kind === 'house' ? .9 : 1 },
        sourcePath: `output/simple-building-study/sources/${sourceId}.png`, variants: {} };
      for (const density of [16, 32]) {
        const factor = density / 16, [width, height] = definition.canvas.map(value => value * factor);
        const [maximumWidth, maximumHeight] = definition.maxContent.map(value => value * factor);
        const scale = Math.min(maximumWidth / crop[2], maximumHeight / crop[3]);
        // Fit uniformly inside each deliberately different box. Never stretch
        // all houses to one rectangle or fill the L-shaped villa's alpha notch.
        const contentWidth = Math.max(1, Math.min(maximumWidth, Math.round(crop[2] * scale)));
        const contentHeight = Math.max(1, Math.min(maximumHeight, Math.round(crop[3] * scale)));
        const x = Math.floor((width - contentWidth) / 2), y = definition.baseline * factor - contentHeight;
        const canvas = make(width, height);
        canvas.getContext('2d').drawImage(image, ...crop, x, y, contentWidth, contentHeight);
        quantize(canvas, palette);
        if (density === 16) native16.set(definition.id, canvas);
        const measurements = stats(canvas);
        if (measurements.colors > palette.length || measurements.alphaValues.some(value => value !== 0 && value !== 255))
          throw new Error(`Palette/alpha contract failed for ${definition.id} at ${density}px.`);
        const relative = `native/p${density}/${definition.id}.png`;
        files.push({ path: relative, data: canvas.toDataURL('image/png').split(',')[1] });
        asset.variants[`p${density}`] = { path: `output/simple-building-study/${relative}`, width, height,
          frameWidth: width, frameHeight: height, frames: 1, fps: 1, pixelsPerCell: density,
          targetRect: [x, y, contentWidth, contentHeight], ...measurements };
      }
      imports.push({ id: definition.id, source: `sources/${sourceId}.png`, sourceRegion: region, rect: crop,
        sourceAspectRatio: crop[2] / crop[3], canvasAt16: definition.canvas, maximumContentAt16: definition.maxContent,
        baselineAt16: definition.baseline, fitting: 'Uniform aspect-preserving fit with nearest integer pixel dimensions.',
        palette: definition.kind === 'farm' ? 'grain5' : 'wood8' });
      assets.push(asset);
    }
    // Review images are separate from the exports and never become game art.
    // Both use an integer 8× magnification, with the identical alpha silhouette.
    for (const silhouette of [false, true]) {
      const canvas = make(1280, 640), c = canvas.getContext('2d');
      c.fillStyle = '#29362b'; c.fillRect(0, 0, canvas.width, canvas.height);
      c.font = '18px monospace'; c.textBaseline = 'top';
      for (const [index, asset] of assets.entries()) {
        const source = native16.get(asset.id), column = index % 4, row = Math.floor(index / 4);
        c.fillStyle = '#e9e6c9'; c.fillText(asset.name, column * 320 + 16, row * 320 + 12);
        let image = source;
        if (silhouette) {
          image = make(source.width, source.height);
          const mask = image.getContext('2d'); mask.drawImage(source, 0, 0);
          mask.globalCompositeOperation = 'source-in'; mask.fillStyle = '#f1edcf';
          mask.fillRect(0, 0, image.width, image.height);
        }
        c.drawImage(image, column * 320 + (320 - image.width * 8) / 2,
          row * 320 + 304 - image.height * 8, image.width * 8, image.height * 8);
      }
      files.push({ path: silhouette ? 'preview/p16-silhouettes.png' : 'preview/p16-montage.png',
        data: canvas.toDataURL('image/png').split(',')[1] });
    }
    return { files, assets, imports, sourceDimensions: Object.fromEntries(Object.entries(images).map(([id, image]) => [id, { width: image.width, height: image.height }])) };
  }, { input, wood, grain, definitions });
} finally {
  await browser.close();
}

for (const file of result.files) {
  const destination = path.join(root, file.path);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, Buffer.from(file.data, 'base64'));
}
const manifest = {
  title: 'Simple wooden buildings', created: '2026-10-26', logicalCellSize: 32,
  description: 'New sparse artwork and clearly different house silhouettes at 16 and 32 pixels per world cell.',
  scope: 'Standalone review only. Production artwork and gameplay are unchanged.',
  options: [{ id: 'p16', label: '16 px', pixelsPerCell: 16, recommended: true }, { id: 'p32', label: '32 px', pixelsPerCell: 32 }],
  palettes: { wood8: wood, grain5: grain },
  previews: { p16: 'output/simple-building-study/preview/p16-montage.png',
    silhouettes: 'output/simple-building-study/preview/p16-silhouettes.png' },
  references: {
    atlas: { path: 'public/assets/puny-world/overworld.png', width: 432, height: 1040 },
    units: Object.fromEntries([['leader', 'Warrior-Blue.png'], ['worker', 'Human-Worker-Cyan.png'], ['warrior', 'Human-Soldier-Cyan.png']].map(([role, file]) => [role, {
      path: `public/assets/puny-world/characters/${file}`, width: 768, height: 256, frameWidth: 32, frameHeight: 32,
      walkFrames: role === 'leader' ? [1, 2, 3] : [1, 2, 3, 4], fps: 9, drawWidth: 44.8, drawHeight: 44.8,
    }])),
    fences: Object.fromEntries(['horizontal', 'vertical', 'post'].map(part => [part, { path: `output/art-resolution-study/current/fence-${part}.png` }])),
  },
  import: { sampler: 'nearest-neighbor', alphaCutoff: 128, dithering: false,
    paletteMapping: 'Nearest weighted RGB color; maximum eight wood or five grain colors.',
    preserveAspectRatio: true, originals: 'output/simple-building-study/sources/', prompts: 'output/simple-building-study/prompts.json', crops: result.imports,
    grain: 'Two whole transparent patches, green on the left and ripe on the right. Three rows of three simple clumps per patch. Static native overlays; no soil is baked in.',
  },
  sources: sources.map(id => ({ id, ...sourceRecords[id], ...result.sourceDimensions[id] })),
  assets: result.assets,
};
await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${result.assets.length * 2} native PNGs and two review images; no production files changed.`);
for (const asset of result.assets) {
  const variant = asset.variants.p16;
  console.log(`${asset.id}: ${variant.width}×${variant.height}, content ${variant.alphaBounds.join(',')}, ${variant.colors} colors`);
}
