import { CAMP_LAYOUTS as ALL_CAMP_LAYOUTS, validateCampLayout, type CampLayout } from './layouts';
import { rasterTerrain } from '../../src/game/terrain';
import { rasterDirtRoad } from '../../src/game/road-sprites';
import { recolorPunyBuildingPixels } from '../../src/game/puny-building-art';
import type { PunyPixels } from '../../src/game/puny-world';
import type { World } from '../../src/game/types';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const payload = window as unknown as { MARAUDER_ASSETS: Record<string, string>;
  MARAUDER_FOCUS?: { campId: string; previousWidth: number; previousHeight: number } };
const CAMP_LAYOUTS = payload.MARAUDER_FOCUS
  ? ALL_CAMP_LAYOUTS.filter(layout => layout.id === payload.MARAUDER_FOCUS!.campId) : ALL_CAMP_LAYOUTS;
const images: Record<string, HTMLImageElement> = {};
const canvas = $<HTMLCanvasElement>('#scene');
const state = { index: 0, layers: 1, defenses: false, labels: false, grid: false, zoom: 'fit' };
const colors = ['#e9bc68', '#8dd2c4', '#e8a18d'];
const grounds = new Map<string, HTMLCanvasElement>(), sprites = new Map<string, HTMLCanvasElement>();
let atlas: PunyPixels;
const key = (x: number, y: number) => `${x},${y}`;
const hash = (x: number, y: number, seed = 1) => {
  let n = Math.imul(x + seed * 131, 374761393) ^ Math.imul(y + 419, 668265263);
  n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296;
};
function ctx(target: HTMLCanvasElement) { const c = target.getContext('2d')!; c.imageSmoothingEnabled = false; return c; }
function pixels(width: number, height: number, data: Uint8ClampedArray): HTMLCanvasElement {
  const target = document.createElement('canvas'); target.width = width; target.height = height;
  const c = ctx(target), raster = c.createImageData(width, height); raster.data.set(data); c.putImageData(raster, 0, 0); return target;
}
function crop(c: CanvasRenderingContext2D, sheet: string, source: readonly number[], x: number, y: number, w = source[2] * 2, h = source[3] * 2) {
  c.drawImage(images[sheet], source[0], source[1], source[2], source[3], Math.round(x), Math.round(y), w, h);
}
function building(c: CanvasRenderingContext2D, source: readonly [number, number, number, number], x: number, y: number) {
  const id = source.join(','); let image = sprites.get(id);
  if (!image) { const recolored = recolorPunyBuildingPixels(atlas, source, '#8e6950'); image = pixels(recolored.width, recolored.height, recolored.data); sprites.set(id, image); }
  c.drawImage(image, x, y, source[2] * 2, source[3] * 2);
}
function terrain(layout: CampLayout): HTMLCanvasElement {
  const cached = grounds.get(layout.id); if (cached) return cached;
  const world: World = { width: layout.width, height: layout.height, seed: layout.id, source: 'camp study', spawns: [],
    tiles: Array.from({ length: layout.width * layout.height }, (_, index) => {
      const x = index % layout.width, y = Math.floor(index / layout.width);
      return { terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .6,
        food: 1, production: 0, gold: 0, variation: hash(x, y, layout.id.charCodeAt(0)) };
    }) };
  const raster = rasterTerrain(world, undefined, atlas), original = pixels(raster.width, raster.height, raster.pixels);
  const target = document.createElement('canvas'); target.width = layout.width * 32; target.height = layout.height * 32;
  const c = ctx(target); c.drawImage(original, 0, 0, target.width, target.height);
  const paths = new Set(layout.paths.map(point => key(point.x, point.y)));
  for (const point of layout.paths) {
    const links = { north: paths.has(key(point.x, point.y - 1)), east: paths.has(key(point.x + 1, point.y)),
      south: paths.has(key(point.x, point.y + 1)), west: paths.has(key(point.x - 1, point.y)) };
    const id = `road:${Number(links.north) + 2 * Number(links.east) + 4 * Number(links.south) + 8 * Number(links.west)}`;
    let image = sprites.get(id); if (!image) { image = pixels(32, 32, rasterDirtRoad(links, atlas)); sprites.set(id, image); }
    c.drawImage(image, point.x * 32, point.y * 32);
  }
  grounds.set(layout.id, target); return target;
}
const stockade = {
  horizontal: [32, 48, 16, 16], vertical: [0, 16, 16, 16],
  nw: [16, 0, 16, 16], ne: [48, 0, 16, 16], sw: [16, 32, 16, 16], se: [48, 32, 16, 16],
} as const;
function wall(c: CanvasRenderingContext2D, x: number, y: number, cells: Set<string>) {
  // The entire wall, including any junction overlay, stays in one map cell.
  c.save(); c.beginPath(); c.rect(x * 32, y * 32, 32, 32); c.clip();
  const n = cells.has(key(x, y - 1)), e = cells.has(key(x + 1, y)), s = cells.has(key(x, y + 1)), w = cells.has(key(x - 1, y));
  const mask = Number(n) + Number(e) * 2 + Number(s) * 4 + Number(w) * 8;
  const source = mask === 6 ? stockade.nw : mask === 12 ? stockade.ne : mask === 3 ? stockade.sw : mask === 9 ? stockade.se
    : mask === 5 || mask === 1 || mask === 4 ? stockade.vertical : stockade.horizontal;
  crop(c, 'palisades', source, x * 32, y * 32);
  if (n && s && (e || w)) {
    c.save(); c.beginPath(); c.rect(x * 32, y * 32, 16, 32); c.clip();
    crop(c, 'palisades', stockade.vertical, x * 32, y * 32); c.restore();
  }
  c.restore();
}
function tower(c: CanvasRenderingContext2D, x: number, y: number, tier: number, i: number) {
  // Mix the complete native timber lookout with the game's platform-and-post
  // watchtower. Both retain a one-cell ground footprint and original pixels.
  if ((tier + i) % 3 === 0) crop(c, 'lookouts', [i % 2 ? 48 : 0, 0, 16, 32], x * 32, y * 32 - 32);
  else {
    crop(c, 'world', [352, 432, 4, 16], x * 32 + 4, y * 32, 8, 32);
    crop(c, 'world', [352, 432, 4, 16], x * 32 + 20, y * 32, 8, 32);
    building(c, [112, 432, 16, 16], x * 32, y * 32 - 24);
  }
}
function scene(target: HTMLCanvasElement, layout: CampLayout, options = state) {
  target.width = layout.width * 32; target.height = layout.height * 32;
  const c = ctx(target); c.drawImage(terrain(layout), 0, 0);
  const walls = layout.walls.filter(point => point.tier >= options.layers), gates = layout.gates.filter(point => point.tier >= options.layers);
  const wallCells = new Set([...walls, ...gates].map(point => key(point.x, point.y)));
  const draw: { depth: number; order: number; run: () => void }[] = [];
  for (const point of walls) draw.push({ depth: point.y + .9, order: 1, run: () => wall(c, point.x, point.y, wallCells) });
  for (const point of gates) draw.push({ depth: point.y + .9, order: 1, run: () => crop(c, 'palisades', [144, point.axis === 'ns' ? 0 : 16, 16, 16], point.x * 32, point.y * 32) });
  for (const [i, point] of layout.towers.entries()) if (point.tier >= options.layers)
    draw.push({ depth: point.y + .95, order: 2, run: () => tower(c, point.x, point.y, point.tier, i) });
  for (const point of layout.tents) draw.push({ depth: point.y + .95, order: 1, run: () => {
    c.save(); if (point.tier < options.layers) c.globalAlpha = .28;
    building(c, [64, 416, 16, 16], point.x * 32, point.y * 32);
    c.restore();
  } });
  for (const [i, point] of layout.signs.entries()) draw.push({ depth: point.y + 15 / 16, order: 1,
    run: () => crop(c, 'world', [112 + i % 3 * 16, 480, 16, 16], point.x * 32, point.y * 32) });
  draw.sort((a, b) => a.depth - b.depth || a.order - b.order); for (const item of draw) item.run();
  if (options.defenses) {
    for (const point of [...walls, ...gates]) { c.fillStyle = colors[point.tier - 1] + '55'; c.fillRect(point.x * 32, point.y * 32, 32, 32); }
    for (const point of gates) {
      c.strokeStyle = '#fff8db'; c.lineWidth = 3; c.setLineDash([4, 4]);
      c.strokeRect(point.x * 32 + 3, point.y * 32 + 3, 26, 26); c.setLineDash([]);
    }
  }
  if (options.grid) {
    c.strokeStyle = '#15221b80'; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x <= layout.width; x++) { c.moveTo(x * 32 + .5, 0); c.lineTo(x * 32 + .5, target.height); }
    for (let y = 0; y <= layout.height; y++) { c.moveTo(0, y * 32 + .5); c.lineTo(target.width, y * 32 + .5); }
    c.stroke();
  }
  if (options.labels) for (const zone of layout.zones) {
    const x = (zone.x + zone.width / 2) * 32, y = (zone.y + .5) * 32;
    c.font = '600 15px system-ui'; const width = c.measureText(zone.label).width + 20;
    c.fillStyle = '#17201ee6'; c.fillRect(x - width / 2, y - 13, width, 26);
    c.fillStyle = '#f8edd2'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(zone.label, x, y);
  }
  Object.assign(target.dataset, { id: layout.id, layers: String(options.layers), grid: String(options.grid) });
}
function sizeCanvas() {
  const wrap = canvas.parentElement!, native = state.zoom === 'fit' ? Math.min(wrap.clientWidth / canvas.width, 620 / canvas.height, 1) : Number(state.zoom) / 2;
  canvas.style.width = `${Math.floor(canvas.width * native)}px`; canvas.style.height = `${Math.floor(canvas.height * native)}px`;
}
function render() {
  const layout = CAMP_LAYOUTS[state.index];
  scene(canvas, layout); sizeCanvas();
  $('#camp-name').textContent = layout.name; $('#camp-id').textContent = layout.id; $('#camp-subtitle').textContent = layout.subtitle;
  $('#description').textContent = layout.description;
  const comparison = payload.MARAUDER_FOCUS ?? { previousWidth: layout.previousWidth, previousHeight: layout.previousHeight };
  $('#stats').innerHTML = [[`${layout.width} × ${layout.height}`, 'map tiles'], [String(layout.tierCount), 'wall tiers'],
    [String(layout.towers.length), 'guard towers'], [String(layout.gates.length), 'gates'], [String(layout.tents.length), 'tents'],
    [`${Math.round((1 - layout.width * layout.height / (comparison.previousWidth * comparison.previousHeight)) * 100)}%`,
      payload.MARAUDER_FOCUS ? 'smaller than the 25 × 25 camp' : 'less map area']]
    .map(([value, label]) => `<div><b>${value}</b><span>${label}</span></div>`).join('');
  $('#zone-list').replaceChildren(...layout.zones.map(zone => { const li = document.createElement('li'); li.textContent = zone.label; return li; }));
  $('#tier-legend').innerHTML = colors.slice(0, layout.tierCount).map((color, i) => `<span><i style="background:${color}"></i>Tier ${i + 1}</span>`).join('');
  document.querySelectorAll<HTMLButtonElement>('#camp-tabs button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === state.index)));
  $<HTMLOptionElement>('#layers option[value="3"]').disabled = layout.tierCount < 3;
  const save = $<HTMLAnchorElement>('#save'); save.href = canvas.toDataURL(); save.download = `marauder-camp-${layout.id}.png`;
  $('#canvas-note').textContent = `${layout.id} · ${layout.width} × ${layout.height} tiles · ${state.layers > 1 ? 'Outer defenses lifted' : 'All defenses shown'}`;
}
function select(index: number) { state.index = index; state.layers = 1; $<HTMLSelectElement>('#layers').value = 'all'; render(); }
$('#zoom').onchange = event => { state.zoom = (event.target as HTMLSelectElement).value; sizeCanvas(); };
$('#layers').onchange = event => { state.layers = Number((event.target as HTMLSelectElement).value) || 1; render(); };
for (const option of ['defenses', 'labels', 'grid'] as const) $<HTMLInputElement>(`#${option}`).onchange = event => { state[option] = (event.target as HTMLInputElement).checked; render(); };
window.addEventListener('resize', sizeCanvas);

async function main() {
  await Promise.all(Object.entries(payload.MARAUDER_ASSETS).map(async ([key, url]) => { const image = new Image(); image.src = url; await image.decode(); images[key] = image; }));
  const image = images.world, source = document.createElement('canvas'); source.width = image.width; source.height = image.height;
  const c = ctx(source); c.drawImage(image, 0, 0); atlas = { width: image.width, height: image.height, data: c.getImageData(0, 0, image.width, image.height).data };
  for (const [index, layout] of CAMP_LAYOUTS.entries()) {
    const tab = document.createElement('button'); tab.dataset.index = String(index); tab.textContent = `${layout.id}  ${layout.name}`; tab.onclick = () => select(index); $('#camp-tabs').append(tab);
    const card = document.createElement('button'); card.className = 'overview-card'; card.dataset.index = String(index);
    card.innerHTML = `<canvas aria-label="${layout.name} overview"></canvas><span><b>${layout.id} · ${layout.name}</b><small>${layout.width} × ${layout.height} · ${layout.tents.length} tents</small></span>`;
    scene(card.querySelector('canvas')!, layout, { ...state, layers: 1, defenses: false, labels: false });
    card.onclick = () => { select(index); $('#viewer').scrollIntoView({ behavior: 'smooth', block: 'start' }); }; $('#overview').append(card);
  }
  render();
  (window as any).__marauderReview = { layouts: CAMP_LAYOUTS, images, get current() { return state; }, validateCampLayout, render, select, footprint: () => [1, 1] };
  document.documentElement.dataset.ready = 'true'; $('#loading').hidden = true;
}
main().catch(error => { $('#loading').textContent = `Could not open review: ${String(error)}`; console.error(error); });
