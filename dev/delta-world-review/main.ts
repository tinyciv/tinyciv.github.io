import { rasterTerrain } from '../../src/game/terrain';
import { ridgeIsLedge } from '../../src/game/ridges';
import { vegetationVariant } from '../../src/game/vegetation-art';
import { WATER } from '../../src/game/types';
import type { PunyPixels } from '../../src/game/puny-world';
import { LANDFORM_NAMES } from '../../src/world/options';
import type { DeltaRecord, DeltaWorld, ReviewRecord } from './model';

const $ = <T extends HTMLElement>(query: string) => document.querySelector<T>(query)!;
const payload = window as unknown as { DELTA_REVIEW_DATA: ReviewRecord[]; DELTA_REVIEW_ASSETS: Record<string, string> };
const records = payload.DELTA_REVIEW_DATA, worlds = new Map<string, DeltaWorld>(), beforeWorlds = new Map<string, DeltaWorld>();
const images: Record<string, HTMLImageElement> = {};
let atlas: PunyPixels, desert: PunyPixels;
const state = { record: 0, delta: 0, plants: true, before: false, scale: 0, whole: false };
let region = { x: 0, y: 0, width: 40, height: 30 };
let selectedWorld: DeltaWorld | undefined, renderToken = 0;
const canvas = $<HTMLCanvasElement>('#detail');

function context(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const c = target.getContext('2d', { willReadFrequently: true })!; c.imageSmoothingEnabled = false; return c;
}
function pixelCanvas(width: number, height: number, pixels: Uint8ClampedArray): HTMLCanvasElement {
  const target = document.createElement('canvas'); target.width = width; target.height = height;
  const c = context(target), data = c.createImageData(width, height); data.data.set(pixels); c.putImageData(data, 0, 0); return target;
}
function imagePixels(image: HTMLImageElement): PunyPixels {
  const target = document.createElement('canvas'); target.width = image.width; target.height = image.height;
  const c = context(target); c.drawImage(image, 0, 0);
  return { width: target.width, height: target.height, data: c.getImageData(0, 0, target.width, target.height).data };
}
async function unpack(record: ReviewRecord, before = false): Promise<DeltaWorld> {
  const cache = before ? beforeWorlds : worlds, existing = cache.get(record.id); if (existing) return existing;
  const bytes = Uint8Array.from(atob(before ? record.compressedBefore : record.compressedWorld), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const world = JSON.parse(await new Response(stream).text()) as DeltaWorld; cache.set(record.id, world); return world;
}
function hash(x: number, y: number): number {
  let n = Math.imul(x + 781, 374761393) ^ Math.imul(y + 613, 668265263); n = Math.imul(n ^ n >>> 13, 1274126177); return (n ^ n >>> 16) >>> 0;
}
function vegetation(c: CanvasRenderingContext2D, world: DeltaWorld, bounds: typeof region, marshPlants: boolean, size: number): number {
  let plants = 0;
  // Row order matches the native ground anchor, so nearer crowns cover farther tiles.
  for (let y = bounds.y; y < Math.min(world.height, bounds.y + bounds.height + 3); y++) {
    for (let x = Math.max(0, bounds.x - 1); x < Math.min(world.width, bounds.x + bounds.width + 1); x++) {
      const tile = world.tiles[y * world.width + x];
      if (WATER.has(tile.terrain) || tile.stair || ridgeIsLedge(world, x, y)) continue;
      const dx = (x - bounds.x) * size, base = (y - bounds.y + 15 / 16) * size;
      if (tile.marsh) {
        if (!marshPlants) continue;
        const image = images[`plant${hash(x, y) % 4}`];
        c.drawImage(image, dx - size / 2, base - size * 2.45, size * 2, size * 2.45); plants++;
      } else {
        const sprite = vegetationVariant(tile); if (!sprite) continue;
        const height = size * sprite.height / 16;
        c.drawImage(images.vegetation, sprite.x, sprite.y, sprite.width, sprite.height, dx, (y - bounds.y + 1) * size - height, size, height);
      }
    }
  }
  return plants;
}
function marker(c: CanvasRenderingContext2D, delta: DeltaRecord, world: DeltaWorld, scale: number, selected: boolean): void {
  const x = (delta.mouth % world.width + .5) * scale, y = (Math.floor(delta.mouth / world.width) + .5) * scale;
  const factor = scale / 4;
  c.strokeStyle = selected ? '#fff3ba' : '#ead38a'; c.lineWidth = (selected ? 3 : 2) * factor;
  c.beginPath(); c.arc(x, y, 12 * factor, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#122b24'; c.beginPath(); c.arc(x, y, 10 * factor, 0, Math.PI * 2); c.fill();
  c.font = `bold ${12 * factor}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff0bc'; c.fillText(String(delta.id), x, y + .5);
}
async function addCard(record: ReviewRecord, index: number): Promise<void> {
  const world = await unpack(record), card = document.createElement('article'); card.className = 'world-card'; card.dataset.id = record.id;
  card.innerHTML = `<button type="button" aria-label="Explore ${record.name}"><header><h2><span class="id">${record.id}</span>${record.name}</h2><p class="world-meta">${LANDFORM_NAMES[record.family]} · ${record.style}</p></header><canvas aria-label="Whole world with delta markers"></canvas><footer>${record.deltaCount} deltas · ${record.marshTiles.toLocaleString()} dry marsh tiles</footer></button>`;
  $('#gallery').append(card);
  const target = card.querySelector('canvas')!, scale = 4; target.width = world.width * scale; target.height = world.height * scale;
  const c = context(target), raster = rasterTerrain(world, undefined, atlas, desert);
  const native = pixelCanvas(raster.width, raster.height, raster.pixels), nc = context(native);
  vegetation(nc, world, { x: 0, y: 0, width: world.width, height: world.height }, true, 16);
  c.drawImage(native, 0, 0, target.width, target.height);
  for (const delta of world.riverDeltas ?? []) marker(c, delta, world, scale, false);
  card.querySelector('button')!.onclick = () => void selectRecord(index);
  target.onclick = event => {
    event.stopPropagation();
    const bounds = target.getBoundingClientRect(), x = (event.clientX - bounds.left) / bounds.width * world.width, y = (event.clientY - bounds.top) / bounds.height * world.height;
    const deltas = world.riverDeltas ?? [];
    const closest = deltas.reduce((best, delta, i) => {
      const distance = Math.hypot(delta.mouth % world.width - x, Math.floor(delta.mouth / world.width) - y);
      return distance < best.distance ? { distance, index: i } : best;
    }, { distance: Infinity, index: 0 });
    void selectRecord(index, closest.index);
  };
}
async function selectRecord(index: number, deltaIndex = 0): Promise<void> {
  state.record = index; state.delta = deltaIndex; state.before = false; state.whole = false;
  const world = await unpack(records[index]);
  $('#before').textContent = 'Without deltas'; $('#before').setAttribute('aria-pressed', 'false');
  const selector = $<HTMLSelectElement>('#delta'); selector.replaceChildren();
  for (const [i, delta] of (world.riverDeltas ?? []).entries()) {
    const option = document.createElement('option'); option.value = String(i); option.textContent = `Mouth ${delta.id}`; selector.append(option);
  }
  if (!selector.options.length) { const option = document.createElement('option'); option.textContent = 'No eligible mouth'; selector.append(option); }
  selector.value = String(deltaIndex); selector.disabled = !(world.riverDeltas?.length);
  document.querySelectorAll('.world-card').forEach((card, i) => card.classList.toggle('selected', i === index));
  await render();
}
function crop(world: DeltaWorld, delta?: DeltaRecord): typeof region {
  const b = delta?.bounds ?? { x: world.spawns[0]?.x ?? world.width / 2, y: world.spawns[0]?.y ?? world.height / 2, width: 1, height: 1 };
  const width = Math.min(world.width, Math.max(42, b.width + 14)), height = Math.min(world.height, Math.max(30, b.height + 14));
  return { x: Math.max(0, Math.min(world.width - width, Math.floor(b.x + b.width / 2 - width / 2))),
    y: Math.max(0, Math.min(world.height - height, Math.floor(b.y + b.height / 2 - height / 2))), width, height };
}
async function render(): Promise<void> {
  const token = ++renderToken, record = records[state.record], after = await unpack(record);
  const world = state.before ? await unpack(record, true) : after; if (token !== renderToken) return;
  selectedWorld = world;
  const delta = after.riverDeltas?.[state.delta]; region = state.whole ? { x: 0, y: 0, width: world.width, height: world.height } : crop(after, delta);
  const raster = rasterTerrain(world, region, atlas, desert), native = pixelCanvas(raster.width, raster.height, raster.pixels);
  // Two samples per native terrain pixel preserve the fuller32×48 plant sources.
  const samples = state.whole ? 1 : 2;
  canvas.width = raster.width * samples; canvas.height = raster.height * samples;
  const c = context(canvas); c.drawImage(native, 0, 0, canvas.width, canvas.height);
  const plants = vegetation(c, world, region, state.plants && !state.before, 16 * samples);
  if (state.whole && !state.before) for (const mouth of after.riverDeltas ?? []) marker(c, mouth, after, 16 * samples, mouth.id === delta?.id);
  canvas.dataset.samples = String(samples); sizeCanvas();
  $('#detail-title').textContent = `${record.id} · ${record.name}${state.whole ? ' / Whole world' : delta ? ` / Mouth ${delta.id}` : ''}`;
  $('#detail-subtitle').textContent = state.before ? 'Same seed generated without coastal deltas' : `${record.seed} · ${record.width} × ${record.height} tiles · Native game terrain`;
  $('#detail-facts').textContent = state.before ? 'Comparison world · same seed, delta generation disabled' : state.whole
    ? `${record.deltaCount} coastal deltas · ${record.marshTiles} dry marsh tiles · Click a delta to inspect its terrain`
    : delta
    ? `${delta.marshCells.length} dry marsh tiles · ${delta.waterCells.length} water tiles · ${delta.distributaries.length} distributary branches · ${state.plants ? `${plants} plant tufts in view` : 'Marsh plants lifted'}` : 'No suitable mouth in this world';
  const link = $<HTMLAnchorElement>('#save'); link.href = canvas.toDataURL(); link.download = `${state.whole ? 'world' : 'delta'}-${record.id}-${state.whole ? 'overview' : delta?.id ?? 'world'}${state.before ? '-without-deltas' : state.plants ? '-plants' : '-bare'}.png`;
  $('#plants').setAttribute('aria-pressed', String(!state.plants)); $('#plants').textContent = state.plants ? 'Lift marsh plants' : 'Restore marsh plants';
  $<HTMLButtonElement>('#plants').disabled = state.before;
  $('#whole').textContent = state.whole ? 'Delta detail' : 'Whole world'; $('#whole').setAttribute('aria-pressed', String(state.whole));
  Object.assign(canvas.dataset, { record: String(state.record), delta: String(state.delta), before: String(state.before), plants: String(state.plants), whole: String(state.whole) });
}
function sizeCanvas(): void {
  const wrap = canvas.parentElement!, samples = +(canvas.dataset.samples ?? 2), width = canvas.width / samples, height = canvas.height / samples;
  const fit = Math.min(2, wrap.clientWidth / width, parseFloat(getComputedStyle(wrap).maxHeight) / height);
  const scale = state.whole || !state.scale ? fit : state.scale;
  canvas.style.width = `${width * scale}px`; canvas.style.height = `${height * scale}px`;
  wrap.scrollLeft = Math.max(0, (width * scale - wrap.clientWidth) / 2); wrap.scrollTop = Math.max(0, (height * scale - wrap.clientHeight) / 2);
}
$('#delta').onchange = event => { state.delta = +(event.target as HTMLSelectElement).value; state.whole = false; void render(); };
$('#plants').onclick = () => { state.plants = !state.plants; void render(); };
$('#whole').onclick = () => { state.whole = !state.whole; void render(); };
$('#before').onclick = () => { state.before = !state.before; $('#before').textContent = state.before ? 'Show delta' : 'Without deltas'; $('#before').setAttribute('aria-pressed', String(state.before)); void render(); };
$('#scale').onchange = event => { state.scale = +(event.target as HTMLSelectElement).value; void render(); };
canvas.onclick = event => {
  if (!state.whole || state.before || !selectedWorld?.riverDeltas?.length) return;
  const world = selectedWorld, rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * world.width, y = (event.clientY - rect.top) / rect.height * world.height;
  state.delta = world.riverDeltas!.reduce((best, delta, index) => {
    const distance = Math.hypot(delta.mouth % world.width - x, Math.floor(delta.mouth / world.width) - y);
    return distance < best.distance ? { distance, index } : best;
  }, { distance: Infinity, index: 0 }).index;
  state.whole = false; $<HTMLSelectElement>('#delta').value = String(state.delta); void render();
};
new ResizeObserver(sizeCanvas).observe(canvas.parentElement!);
Object.assign(window, { __deltaReview: { records, state, worlds, get world() { return selectedWorld; }, get region() { return region; }, render, selectRecord } });
try {
  await Promise.all(Object.entries(payload.DELTA_REVIEW_ASSETS).map(async ([id, uri]) => { const image = new Image(); image.src = uri; await image.decode(); images[id] = image; }));
  atlas = imagePixels(images.world); desert = imagePixels(images.desert);
  for (const [index, record] of records.entries()) { await addCard(record, index); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
  await selectRecord(0); $('#loading').remove();
  $('#status').textContent = `${records.length} complete worlds · ${records.reduce((sum, record) => sum + record.deltaCount, 0)} generated deltas · Embedded maps and artwork · Works offline`;
  document.documentElement.dataset.ready = 'true';
} catch (error) { $('#loading').textContent = `Could not open this review: ${String(error)}`; console.error(error); }
