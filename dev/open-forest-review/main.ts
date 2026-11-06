import { rasterTerrain } from '../../src/game/terrain';
import { ridgeIsLedge, ridgeLevel, STAIR_UP } from '../../src/game/ridges';
import { vegetationVariant } from '../../src/game/vegetation-art';
import { WATER, type World } from '../../src/game/types';
import type { PunyPixels } from '../../src/game/puny-world';
import { BIOME_NAMES, RESOURCE_NAMES } from '../../src/game/geography';
import { overviewPixels } from '../fractal-gallery/model';
import type { ReviewRecord } from './model';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const payload = window as unknown as { FOREST_REVIEW_DATA: ReviewRecord[]; FOREST_REVIEW_ASSETS: { world: string; desert: string; vegetation: string } };
const records = payload.FOREST_REVIEW_DATA;
const colors = ['#ed7369', '#71c1ff', '#efcf70', '#c79dff', '#76dfc0', '#f59ac2', '#bbc475', '#e2a260', '#aab5f7', '#75c786', '#d8bc96'];
const title = (record: ReviewRecord) => record.style[0].toUpperCase() + record.style.slice(1);
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const detail = $<HTMLCanvasElement>('#detail'), dialog = $<HTMLDialogElement>('#inspector');
let atlas: PunyPixels, desertAtlas: PunyPixels, trees: HTMLImageElement;
let selected: ReviewRecord | undefined, world: World | undefined, center = { x: 137, y: 108 }, zoom = 24;
let dragging: { x: number; y: number; cx: number; cy: number } | undefined, pending = false, selection = 0, forestCursor = -1;
let overview: HTMLCanvasElement | undefined, bareOverview: HTMLCanvasElement | undefined;
const worlds = new Map<string, World>(), previews = new Map<string, HTMLImageElement>();
let favorites = new Set<string>();
try { favorites = new Set(JSON.parse(localStorage.getItem('btv-open-forest-review') ?? '[]')); } catch { /* File storage is optional. */ }

async function imagePixels(url: string): Promise<PunyPixels> {
  const image = new Image(); image.src = url; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
}
function pixelCanvas(width: number, height: number, pixels: Uint8ClampedArray): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!, data = context.createImageData(width, height); data.data.set(pixels); context.putImageData(data, 0, 0);
  return canvas;
}
function markers(context: CanvasRenderingContext2D, record: ReviewRecord, ox: number, oy: number, scale: number, small = false): void {
  if (!$<HTMLInputElement>('#show-starts').checked) return;
  context.save();
  for (const [i, point] of record.secondary.entries()) {
    context.fillStyle = colors[i + 1]; context.strokeStyle = '#102016'; context.lineWidth = 1;
    context.beginPath(); context.arc(ox + point.x * scale, oy + point.y * scale, small ? 2.8 : 4, 0, Math.PI * 2); context.fill(); context.stroke();
  }
  for (const [i, point] of record.capitals.entries()) {
    const x = ox + point.x * scale, y = oy + point.y * scale;
    context.fillStyle = '#102016'; context.strokeStyle = colors[i]; context.lineWidth = 1.5;
    context.beginPath(); context.arc(x, y, small ? 6 : 9, 0, Math.PI * 2); context.fill(); context.stroke();
    context.font = `600 ${small ? 8 : 10}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = colors[i]; context.fillText(String(i + 1), x, y);
  }
  context.restore();
}
function drawCard(record: ReviewRecord): void {
  const canvas = $<HTMLCanvasElement>(`[data-id="${record.id}"] canvas`), image = previews.get(record.id);
  if (!image) return;
  canvas.width = record.width * 2; canvas.height = record.height * 2;
  const context = canvas.getContext('2d')!; context.imageSmoothingEnabled = false; context.drawImage(image, 0, 0, canvas.width, canvas.height);
  markers(context, record, 0, 0, 2, true);
}
function updateFavorites(): void {
  for (const record of records) {
    const card = $(`[data-id="${record.id}"]`), marked = favorites.has(record.id);
    card.classList.toggle('favorite', marked);
    card.querySelector('button.favorite-button')!.textContent = marked ? '★' : '☆';
    card.querySelector('button.favorite-button')!.setAttribute('aria-pressed', String(marked));
  }
  if (selected) { $('#detail-favorite').textContent = favorites.has(selected.id) ? '★' : '☆'; $('#detail-favorite').setAttribute('aria-pressed', String(favorites.has(selected.id))); }
}
function toggleFavorite(record: ReviewRecord): void {
  if (favorites.has(record.id)) favorites.delete(record.id); else favorites.add(record.id);
  try { localStorage.setItem('btv-open-forest-review', JSON.stringify([...favorites])); } catch { /* Keep session choices. */ }
  updateFavorites();
}
async function addCard(record: ReviewRecord): Promise<void> {
  const card = document.createElement('article'); card.className = 'sample'; card.dataset.id = record.id;
  const s = record.summary;
  card.innerHTML = `<div class="sample-head"><h3><span class="sample-number">${record.id}</span>${title(record)}</h3><button class="favorite-button" aria-label="Favorite ${record.id}" aria-pressed="false">☆</button></div><p class="card-seed">${record.seed}</p><button class="open-map" aria-label="Explore world ${record.id}"><canvas aria-hidden="true"></canvas><span class="explore-label">Explore terrain ↗</span></button><div class="sample-bottom"><div class="sample-stats"><span><strong>${percent(s.forest)}</strong>wooded land</span><span><strong>${percent(1 - s.forest)}</strong>unwooded land</span><span><strong>${s.solidTwoByTwo}</strong>solid 2 × 2 patches</span></div><div class="sample-note"><span>${s.lakeCount} lakes · ${s.mountainBodies} ranges</span><button class="forest-jump">Woodland detail ↗</button></div></div>`;
  card.querySelector('.favorite-button')!.addEventListener('click', () => toggleFavorite(record));
  card.querySelector('.open-map')!.addEventListener('click', () => void openRecord(record, 'whole'));
  card.querySelector('.forest-jump')!.addEventListener('click', () => void openRecord(record, 'forest'));
  $('#gallery').append(card);
  const image = new Image(); image.src = record.preview; await image.decode(); previews.set(record.id, image); drawCard(record);
}
async function unpack(record: ReviewRecord): Promise<World> {
  const existing = worlds.get(record.id); if (existing) return existing;
  const bytes = Uint8Array.from(atob(record.compressedWorld), character => character.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const generated = JSON.parse(await new Response(stream).text()) as World;
  worlds.set(record.id, generated); if (worlds.size > 2) worlds.delete(worlds.keys().next().value!);
  return generated;
}
function metrics(record: ReviewRecord): void {
  const s = record.summary;
  $('#selected-metrics').innerHTML = `<div class="metric"><b>${percent(s.forest)}</b><span>of dry land has trees</span></div><div class="metric"><b>${percent(s.adjacentOpenGround)}</b><span>of tree tiles touch reachable open ground</span></div><div class="metric"><b>${s.solidTwoByTwo}</b><span>fully wooded 2 × 2 blocks</span></div>`;
  $('#map-facts').textContent = `${record.width} × ${record.height} tiles · ${record.capitals.length} capitals + ${record.secondary.length} second cities · ${s.lakeCount} lakes · ${s.mountainBodies} mountain bodies`;
  $('#settings').textContent = JSON.stringify({ seed: record.seed, style: record.style, parameters: record.parameters }, null, 2);
  $('#focus-info').textContent = 'Use Woodland ↻ to compare dense forest regions with their paths and clearings.';
}
async function openRecord(record: ReviewRecord, view: 'whole' | 'forest' = 'forest'): Promise<void> {
  const token = ++selection; selected = record; world = undefined; forestCursor = -1;
  $('#detail-title').textContent = `${record.id} · ${title(record)}`; $('#detail-subtitle').textContent = record.seed;
  metrics(record); updateFavorites(); $('#view-loading').hidden = false; $('#view-loading').textContent = 'Opening embedded world…';
  if (!dialog.open) dialog.showModal();
  try {
    const generated = await unpack(record); if (token !== selection) return;
    world = generated;
    overview = pixelCanvas(world.width, world.height, overviewPixels(world));
    bareOverview = pixelCanvas(world.width, world.height, overviewPixels({ ...world,
      tiles: world.tiles.map(tile => tile.overlay === 'forest' || tile.overlay === 'jungle' ? { ...tile, overlay: 'none' } : tile) }));
    $('#view-loading').hidden = true;
    if (view === 'forest') findForest(); else fit();
  } catch (error) { $('#view-loading').textContent = `Could not open this world: ${String(error)}`; console.error(error); }
}
function fit(): void {
  if (!world) return;
  const bounds = detail.getBoundingClientRect(); center = { x: world.width / 2, y: world.height / 2 };
  zoom = Math.max(1, Math.min(bounds.width / world.width, bounds.height / world.height) * .94); scheduleDraw();
}
function findForest(): void {
  if (!world || !selected) return;
  const focuses = selected.summary.woodlandFocus;
  forestCursor = (forestCursor + 1) % Math.max(1, focuses.length);
  const focus = focuses[forestCursor]; center = focus ? { x: focus.x, y: focus.y } : { ...world.spawns[0] }; zoom = 32;
  $('#focus-info').textContent = focus ? `Woodland ${forestCursor + 1} of ${focuses.length}: ${percent(focus.woodland / focus.land)} of dry tiles in this 15 × 15 area have trees. Click again for another region.` : 'No dense forest region in this world.';
  scheduleDraw();
}
function findFeature(kind: 'mountains' | 'lake' | 'start'): void {
  if (!world) return;
  const cells = world.tiles.flatMap((tile, i) => kind === 'lake' ? tile.terrain === 'lake' ? [i] : [] : tile.relief === 'mountains' ? [i] : []);
  const cell = cells[Math.floor(cells.length / 2)];
  center = kind === 'start' || cell === undefined ? { ...world.spawns[0] } : { x: cell % world.width + .5, y: Math.floor(cell / world.width) + .5 };
  zoom = 24; scheduleDraw();
}
function draw(): void {
  pending = false; if (!world || !selected || !dialog.open) return;
  const bounds = detail.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  detail.width = Math.round(bounds.width * dpr); detail.height = Math.round(bounds.height * dpr);
  const context = detail.getContext('2d')!; context.setTransform(dpr, 0, 0, dpr, 0, 0); context.imageSmoothingEnabled = false;
  context.fillStyle = '#10231d'; context.fillRect(0, 0, bounds.width, bounds.height);
  center.x = Math.max(0, Math.min(world.width, center.x)); center.y = Math.max(0, Math.min(world.height, center.y));
  const ox = bounds.width / 2 - center.x * zoom, oy = bounds.height / 2 - center.y * zoom;
  const left = Math.max(0, Math.floor(-ox / zoom)), top = Math.max(0, Math.floor(-oy / zoom));
  const right = Math.min(world.width, Math.ceil((bounds.width - ox) / zoom)), bottom = Math.min(world.height, Math.ceil((bounds.height - oy) / zoom));
  const showTrees = $<HTMLInputElement>('#show-woodland').checked;
  if (zoom < 7) context.drawImage((showTrees ? overview : bareOverview)!, ox, oy, world.width * zoom, world.height * zoom);
  else if (right > left && bottom > top) {
    const raster = rasterTerrain(world, { x: left, y: top, width: right - left, height: bottom - top }, atlas, desertAtlas);
    context.drawImage(pixelCanvas(raster.width, raster.height, raster.pixels), ox + left * zoom, oy + top * zoom, (right - left) * zoom, (bottom - top) * zoom);
    if (showTrees) for (let y = top; y < Math.min(world.height, bottom + 1); y++) for (let x = left; x < right; x++) {
      const tile = world.tiles[y * world.width + x]; if (tile.stair || ridgeIsLedge(world, x, y)) continue;
      const sprite = vegetationVariant(tile); if (!sprite) continue;
      const h = zoom * sprite.height / 16;
      context.drawImage(trees, sprite.x, sprite.y, sprite.width, sprite.height, Math.round(ox + x * zoom), Math.round(oy + (y + 1) * zoom - h), zoom, h);
    }
    if ($<HTMLInputElement>('#show-grid').checked) {
      context.strokeStyle = '#18211b55'; context.lineWidth = 1; context.beginPath();
      for (let x = left; x <= right; x++) { context.moveTo(ox + x * zoom, oy + top * zoom); context.lineTo(ox + x * zoom, oy + bottom * zoom); }
      for (let y = top; y <= bottom; y++) { context.moveTo(ox + left * zoom, oy + y * zoom); context.lineTo(ox + right * zoom, oy + y * zoom); } context.stroke();
    }
    if ($<HTMLInputElement>('#show-access').checked) for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const tile = world.tiles[y * world.width + x], sx = ox + (x + .5) * zoom, sy = oy + (y + .5) * zoom;
      if (tile.mountainPass) { context.fillStyle = '#f0d99f'; context.fillRect(sx - 2, sy - 2, 4, 4); }
      if (!tile.stair) continue;
      const up = STAIR_UP[tile.stair], d = zoom * .24, s = zoom * .12;
      context.beginPath(); context.moveTo(sx - up.x * d, sy - up.y * d); context.lineTo(sx + up.x * d, sy + up.y * d);
      context.moveTo(sx - up.y * s, sy + up.x * s); context.lineTo(sx + up.x * d, sy + up.y * d); context.lineTo(sx + up.y * s, sy - up.x * s);
      context.strokeStyle = '#172016'; context.lineWidth = 3; context.stroke(); context.strokeStyle = '#fff2c6'; context.lineWidth = 1.2; context.stroke();
    }
  }
  markers(context, selected, ox, oy, zoom);
  $('#view-tag').textContent = zoom < 7 ? 'N ↑ · Overview · Zoom in for native tree art' : 'N ↑ · Native terrain · Drag to pan · Scroll to zoom';
}
function scheduleDraw(): void { if (!pending) { pending = true; requestAnimationFrame(draw); } }
function zoomTo(value: number): void { zoom = Math.max(1, Math.min(64, value)); scheduleDraw(); }
function download(value: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#download').onclick = () => selected && download({ id: selected.id, seed: selected.seed, style: selected.style, width: selected.width, height: selected.height, parameters: selected.parameters, summary: selected.summary }, `world-${selected.id}-${selected.style}.json`);
$('#download-shortlist').onclick = () => download(records.filter(record => favorites.has(record.id)).map(({ id, seed, style, parameters }) => ({ id, seed, style, parameters })), 'world-review-favorites.json');
$('#close').onclick = () => dialog.close();
$('#detail-favorite').onclick = () => selected && toggleFavorite(selected);
$('#fit').onclick = fit; $('#find-forest').onclick = findForest;
$('#find-mountains').onclick = () => findFeature('mountains'); $('#find-lake').onclick = () => findFeature('lake'); $('#find-start').onclick = () => findFeature('start');
$('#native-scale').onclick = () => zoomTo(zoom === 32 ? 16 : 32);
$('#zoom-in').onclick = () => zoomTo(zoom * 1.25); $('#zoom-out').onclick = () => zoomTo(zoom / 1.25);
for (const id of ['show-woodland', 'show-grid', 'show-access']) $(`#${id}`).onchange = scheduleDraw;
$('#show-starts').onchange = () => { records.forEach(drawCard); scheduleDraw(); };
detail.onwheel = event => { event.preventDefault(); zoomTo(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)); };
detail.onpointerdown = event => { if (event.button !== 0) return; dragging = { x: event.clientX, y: event.clientY, cx: center.x, cy: center.y }; detail.setPointerCapture(event.pointerId); };
detail.onpointerup = detail.onpointercancel = () => { dragging = undefined; };
detail.onpointermove = event => {
  if (!world) return;
  if (dragging) { center = { x: dragging.cx - (event.clientX - dragging.x) / zoom, y: dragging.cy - (event.clientY - dragging.y) / zoom }; scheduleDraw(); }
  const bounds = detail.getBoundingClientRect(), x = Math.floor(center.x + (event.clientX - bounds.left - bounds.width / 2) / zoom), y = Math.floor(center.y + (event.clientY - bounds.top - bounds.height / 2) / zoom);
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return;
  const tile = world.tiles[y * world.width + x];
  $('#tile-info').textContent = `${x}, ${y} · ${tile.biome ? BIOME_NAMES[tile.biome] : tile.terrain} · ${tile.overlay === 'forest' || tile.overlay === 'jungle' ? 'Tree' : WATER.has(tile.terrain) ? 'Water' : 'Open ground'}${tile.stair ? ` · Ramp ${tile.stair}` : ridgeIsLedge(world, x, y) ? ' · Cliff' : tile.ridge ? ` · Upper floor ${ridgeLevel(tile)}` : ''}${tile.fertility !== undefined && !WATER.has(tile.terrain) ? ` · Soil ${Math.round(tile.fertility * 100)}%` : ''}${tile.resource ? ` · ${RESOURCE_NAMES[tile.resource]}` : ''}`;
};
new ResizeObserver(scheduleDraw).observe(detail.parentElement!);
Object.assign(window, { __forestReview: { records, get selected() { return selected; }, get world() { return world; }, get zoom() { return zoom; }, get center() { return center; }, openRecord } });
try {
  trees = new Image(); trees.src = payload.FOREST_REVIEW_ASSETS.vegetation;
  [atlas, desertAtlas] = await Promise.all([imagePixels(payload.FOREST_REVIEW_ASSETS.world), imagePixels(payload.FOREST_REVIEW_ASSETS.desert)]); await trees.decode();
  for (const record of records) await addCard(record);
  updateFavorites(); $('#status').textContent = '9 worlds ready · Everything is embedded · Opens offline'; document.documentElement.dataset.ready = 'true';
} catch (error) { $('#status').textContent = `Unable to open review: ${String(error)}`; $('#status').classList.add('error'); console.error(error); }
