import { buildResourceArtLayout, drawResourceObject, loadResourceArt } from '../../src/game/resource-art';
import { buildLooseRockLayout, drawLooseRocks, drawOutcrop, loadOutcropArt, outcropCell, outcropSeed,
  type OutcropMaterial, type OutcropEdgeStyle } from '../../src/game/outcrop-art';
import type { World } from '../../src/game/types';

const PATCHES = [
  { x: 2, y: 2, rows: ['..##..', '.####.', '######', '.#####', '..###.', '...#..'] },
  { x: 12, y: 2, rows: ['..###..', '.#####.', '#######', '###....', '####...', '.######', '..####.'] },
  { x: 23, y: 3, rows: ['.##.....', '####....', '.###..##', '..######', '....###.', '....##..'] },
  { x: 4, y: 11, rows: ['#'] },
] as const;
const MATERIALS: readonly OutcropMaterial[] = ['stone', 'copper', 'iron'];

function fixture(material: OutcropMaterial, seed: string, developed: boolean): World {
  const width = 32, height = 15;
  const world: World = { width, height, seed, source: 'Outcrop art review', spawns: [], revision: 1,
    tiles: Array.from({ length: width * height }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .4, food: 3, production: 1, gold: 0, variation: .5 })) };
  PATCHES.forEach((patch, group) => patch.rows.forEach((row, y) => [...row].forEach((char, x) => {
    if (char === '#') Object.assign(world.tiles[(patch.y + y) * width + patch.x + x],
      { resource: material, resourceGroup: group + 1, resourceDeveloped: developed });
  })));
  return world;
}

interface ReviewOptions {
  developed?: boolean;
  seed?: string;
  edgeStyle?: OutcropEdgeStyle;
  materials?: readonly OutcropMaterial[];
  compact?: boolean;
  scales?: readonly number[];
}

/** Uses the actual resource and loose-rock draw functions, without a game or simulation. */
export function renderNaturalOutcrops({ developed = false, seed = 'Natural-outcrop-1', edgeStyle = 'grounded',
  materials = MATERIALS, compact = false, scales = [1, 2] }: ReviewOptions = {}): HTMLElement {
  const root = document.createElement('div'); root.className = 'tc-natural-outcrops';
  root.style.cssText = `background:#202c26;color:#eee;padding:${compact ? 0 : 20}px;font:18px "Pixel Operator",monospace;${compact ? '' : 'min-height:100vh'}`;
  const heading = document.createElement('h1');
  heading.textContent = developed ? 'Developed outcrops' : 'Natural outcrops & loose rocks';
  heading.style.cssText = 'font:700 28px "Pixel Operator",monospace;margin:0 0 12px';
  const note = document.createElement('p');
  note.textContent = 'Lighter gray stone is prepared before the unchanged ore overlays are applied. Fuller contours widen narrow connections and soften deep cut-ins; the shaded rim, earthy contact border and loose rocks remain. Native 16px art and 2× enlargement, using the game’s rendering functions without a simulation.';
  note.style.cssText = 'line-height:1.4;max-width:1000px';
  const loading = document.createElement('p'); loading.textContent = 'Loading outcrop artwork…';
  if (!compact) root.append(heading, note);
  root.append(loading);
  const grass = new Image(); grass.src = `${import.meta.env.BASE_URL}assets/puny-world/overworld.png`;
  Promise.all([loadResourceArt(), loadOutcropArt(), grass.decode()]).then(() => {
    loading.remove();
    for (const material of materials) {
      const world = fixture(material, seed, developed), layout = buildResourceArtLayout(world);
      const rubble = buildLooseRockLayout(world, layout.keys());
      const figure = document.createElement('figure'); figure.style.cssText = 'margin:24px 0';
      const caption = document.createElement('figcaption'); caption.textContent = material;
      caption.style.cssText = 'font-size:22px;margin-bottom:8px';
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:16px;align-items:start;flex-wrap:wrap';
      const canvas = document.createElement('canvas'); canvas.width = world.width * 16; canvas.height = world.height * 16;
      const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false;
      for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++)
        c.drawImage(grass, 0, 0, 16, 16, x * 16, y * 16, 16, 16);
      for (const [cell, rocks] of rubble) {
        c.save(); c.translate(cell % world.width * 16, Math.floor(cell / world.width) * 16);
        drawLooseRocks(c, rocks, 16, edgeStyle); c.restore();
      }
      const textureSeed = outcropSeed(seed);
      for (const [cell, art] of layout) {
        const x = cell % world.width, y = Math.floor(cell / world.width);
        if (material === 'stone') drawOutcrop(c, material, outcropCell(world, x, y, textureSeed), x * 16, y * 16, 16, edgeStyle);
        else drawResourceObject(c, art, x * 16, y * 16, 16);
      }
      for (const scale of scales) {
        const image = scale === 1 ? canvas : document.createElement('canvas');
        if (scale !== 1) {
          image.width = canvas.width * scale; image.height = canvas.height * scale;
          const ec = image.getContext('2d')!; ec.imageSmoothingEnabled = false; ec.drawImage(canvas, 0, 0, image.width, image.height);
        }
        image.style.cssText = 'image-rendering:pixelated;max-width:100%;height:auto'; row.append(image);
      }
      figure.append(caption, row); root.append(figure);
    }
    root.dataset.ready = 'true';
  }).catch(error => {
    loading.textContent = `Unable to load outcrop art: ${String(error)}`; loading.setAttribute('role', 'alert');
  });
  return root;
}

export function renderOutcropEdgeComparison(): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = 'background:#202c26;color:#eee;padding:20px;font:18px "Pixel Operator",monospace';
  const heading = document.createElement('h1'); heading.textContent = 'Outcrop edge treatments';
  heading.style.cssText = 'font:700 28px "Pixel Operator",monospace;margin:0 0 12px';
  const note = document.createElement('p');
  note.textContent = 'Compare the archived flat cutout, shaded rim, and rim with ground contact on the same stone patches.';
  note.style.cssText = 'line-height:1.4;max-width:1000px'; root.append(heading, note);
  const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,512px),512px));gap:24px'; root.append(grid);
  for (const [style, label] of [['flat', 'A · Flat cutout (before)'], ['rim', 'B · Shaded stone rim'],
    ['grounded', 'C · Shaded rim + ground contact']] as const) {
    const section = document.createElement('section');
    const title = document.createElement('h2'); title.textContent = label; title.style.cssText = 'font:700 24px "Pixel Operator",monospace;margin:24px 0 8px';
    section.append(title, renderNaturalOutcrops({ edgeStyle: style, materials: ['stone'], compact: true, scales: [1] })); grid.append(section);
  }
  return root;
}

/** Focus on the entrance fitting, including the smallest supported outcrop. */
export function renderMineDoorReview(): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = 'background:#202c26;color:#eee;padding:20px;font:18px "Pixel Operator",monospace;min-height:100vh';
  const heading = document.createElement('h1'); heading.textContent = 'Mine doorways in the new rock';
  heading.style.cssText = 'font:700 28px "Pixel Operator",monospace;margin:0 0 12px';
  const note = document.createElement('p');
  note.textContent = 'The shared timber frame and dark tunnel fit inside the current copper or iron surface, towards its lower edge. Cluster-edge and single-cell mines are shown at native size and 4×.';
  note.style.cssText = 'line-height:1.4;max-width:1000px';
  const loading = document.createElement('p'); loading.textContent = 'Loading mine doorways…'; root.append(heading, note, loading);
  const grass = new Image(); grass.src = `${import.meta.env.BASE_URL}assets/puny-world/overworld.png`;
  Promise.all([loadResourceArt(), grass.decode()]).then(() => {
    loading.remove();
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:24px';
    for (const material of ['copper', 'iron'] as const) {
      const world = fixture(material, 'Natural-outcrop-1', true), layout = buildResourceArtLayout(world);
      const rubble = buildLooseRockLayout(world, layout.keys());
      const mines = [...layout].filter(([, art]) => art.worksite);
      for (const [cell, label] of [[mines[0][0], 'cluster edge'], [mines.at(-1)![0], 'single cell']] as const) {
        const figure = document.createElement('figure'); figure.style.cssText = 'margin:16px 0';
        const caption = document.createElement('figcaption'); caption.textContent = `${material} · ${label}`;
        caption.style.cssText = 'font-size:22px;margin-bottom:12px';
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:16px;align-items:end;flex-wrap:wrap';
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
        const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false;
        const cx = cell % world.width, cy = Math.floor(cell / world.width);
        for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
          const px = (x + 1) * 16, py = (y + 1) * 16, next = (cy + y) * world.width + cx + x;
          c.drawImage(grass, 0, 0, 16, 16, px, py, 16, 16);
          const rocks = rubble.get(next);
          if (rocks) { c.save(); c.translate(px, py); drawLooseRocks(c, rocks, 16); c.restore(); }
          const art = layout.get(next); if (art) drawResourceObject(c, art, px, py, 16);
        }
        const enlarged = document.createElement('canvas'); enlarged.width = enlarged.height = 192;
        const ec = enlarged.getContext('2d')!; ec.imageSmoothingEnabled = false; ec.drawImage(canvas, 0, 0, 192, 192);
        for (const image of [canvas, enlarged]) image.style.cssText = 'image-rendering:pixelated;max-width:100%;height:auto';
        row.append(canvas, enlarged); figure.append(caption, row); grid.append(figure);
      }
    }
    root.append(grid); root.dataset.ready = 'true';
  }).catch(error => { loading.textContent = String(error); loading.setAttribute('role', 'alert'); });
  return root;
}
