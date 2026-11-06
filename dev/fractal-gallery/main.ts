import { generateWorld } from '../../src/world/generator';
import { LANDSCAPE_CONTROLS, resolveLandscapeParameters, type LandscapeParameter } from '../../src/world/options';
import { rasterTerrain } from '../../src/game/terrain';
import { ridgeIsLedge, ridgeLevel, STAIR_UP } from '../../src/game/ridges';
import { vegetationVariant } from '../../src/game/vegetation-art';
import { WATER, type World } from '../../src/game/types';
import type { PunyPixels } from '../../src/game/puny-world';
import { BIOME_NAMES, RESOURCE_NAMES } from '../../src/game/geography';
import { GALLERY_SEED, sampleSettings, measure, overviewPixels, type Record as SampleRecord, type Sample } from './model';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const payload = window as unknown as { FRACTAL_GALLERY_DATA: SampleRecord[]; FRACTAL_GALLERY_ASSETS: { world: string; desert: string; vegetation: string } };
const colors = ['#ed7369', '#71c1ff', '#efcf70', '#c79dff', '#76dfc0', '#f59ac2', '#bbc475', '#e2a260', '#aab5f7', '#75c786', '#d8bc96'];
let records = payload.FRACTAL_GALLERY_DATA, selected: SampleRecord | undefined, world: World | undefined;
let worldCache = new Map<string, World>(), images = new Map<string, HTMLImageElement>();
let atlas: PunyPixels, desertAtlas: PunyPixels, trees: HTMLImageElement;
let center = { x: 137, y: 108 }, zoom = 20, pending = false, generation = 0, selectionToken = 0;
let mountainCursor = -1, mountainFocus = '';
let drag: { x: number; y: number; cx: number; cy: number } | undefined;
const detail = $<HTMLCanvasElement>('#detail'), dialog = $<HTMLDialogElement>('#inspector');
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 16));
const percent = (n: number) => `${Math.round(n * 100)}%`;
const cacheKey = (record: Sample) => JSON.stringify([record.seed, record.parameters]);
let favorites = new Set<string>();
try { favorites = new Set(JSON.parse(localStorage.getItem('btv-fractal-favorites') ?? '[]')); } catch { /* file:// storage may be unavailable */ }

function saveFavorites(): void { try { localStorage.setItem('btv-fractal-favorites', JSON.stringify([...favorites])); } catch { /* keep session favorites */ } }
function favorite(record: SampleRecord): boolean { return favorites.has(cacheKey(record)); }
function toggleFavorite(record: SampleRecord): void {
  const key = cacheKey(record); if (favorites.has(key)) favorites.delete(key); else favorites.add(key); saveFavorites(); updateFavorites();
}
function updateFavorites(): void {
  for (const card of document.querySelectorAll<HTMLElement>('.sample')) {
    const record = records.find(item => item.id === card.dataset.id)!;
    const marked = favorite(record), button = card.querySelector<HTMLButtonElement>('.favorite-button')!;
    card.classList.toggle('favorite', marked); button.textContent = marked ? '★' : '☆'; button.setAttribute('aria-pressed', String(marked));
    card.hidden = $<HTMLInputElement>('#favorites-only').checked && !marked;
  }
  if (selected) { const marked = favorite(selected); $('#detail-favorite').textContent = marked ? '★' : '☆'; $('#detail-favorite').setAttribute('aria-pressed', String(marked)); }
  $('#no-favorites')?.remove();
  if ($<HTMLInputElement>('#favorites-only').checked && !records.some(favorite)) {
    const empty = document.createElement('p'); empty.id = 'no-favorites'; empty.className = 'empty'; empty.textContent = 'Star a map to keep it in this shortlist.'; $('#gallery').append(empty);
  }
}
async function imagePixels(url: string): Promise<PunyPixels> {
  const image = new Image(); image.src = url; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const c = canvas.getContext('2d', { willReadFrequently: true })!; c.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, data: c.getImageData(0, 0, image.width, image.height).data };
}
function markers(c: CanvasRenderingContext2D, record: SampleRecord, ox: number, oy: number, size: number, overview = false): void {
  c.save();
  if ($<HTMLInputElement>('#show-equator').checked) {
    const y = oy + record.parameters.equatorPosition * record.height * size;
    c.setLineDash([6, 5]); c.strokeStyle = '#ffe9b6aa'; c.lineWidth = overview ? 1.4 : 2; c.beginPath(); c.moveTo(ox, y); c.lineTo(ox + record.width * size, y); c.stroke(); c.setLineDash([]);
    c.font = `${overview ? 9 : 11}px system-ui`; c.fillStyle = '#171b11da'; c.fillRect(ox + 5, y - 15, 46, 14); c.fillStyle = '#ffe9b6'; c.fillText('Equator', ox + 9, y - 5);
  }
  if ($<HTMLInputElement>('#show-starts').checked) {
    for (const [index, point] of record.secondary.entries()) {
      c.fillStyle = colors[index + 1]; c.strokeStyle = '#0f180f'; c.lineWidth = 1;
      c.beginPath(); c.arc(ox + point.x * size, oy + point.y * size, overview ? 2.4 : 4.2, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    for (const [index, point] of record.capitals.entries()) {
      const x = ox + point.x * size, y = oy + point.y * size, r = overview ? 5.6 : 9;
      c.fillStyle = '#101b12'; c.strokeStyle = colors[index]; c.lineWidth = overview ? 1.2 : 2;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke();
      c.font = `600 ${overview ? 7 : 10}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = colors[index]; c.fillText(String(index + 1), x, y + .3);
    }
  }
  c.restore();
}
function drawCard(canvas: HTMLCanvasElement, record: SampleRecord): void {
  const image = images.get(cacheKey(record)); if (!image) return;
  canvas.width = record.width * 2; canvas.height = record.height * 2;
  const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false; c.drawImage(image, 0, 0, canvas.width, canvas.height);
  markers(c, record, 0, 0, 2, true);
  c.fillStyle = '#101b12cc'; c.fillRect(7, 7, 25, 19); c.font = '10px system-ui'; c.fillStyle = '#e8e9d5'; c.fillText('N ↑', 11, 20);
}
async function addCard(record: SampleRecord): Promise<void> {
  const image = new Image(); image.src = record.preview; await image.decode(); images.set(cacheKey(record), image);
  const card = document.createElement('article'); card.className = 'sample'; card.dataset.id = record.id;
  const { summary: s } = record;
  card.innerHTML = `<div class="sample-head"><h3><span class="sample-number">${record.id}</span>${record.title}</h3><button class="favorite-button" aria-label="Favorite sample ${record.id}" aria-pressed="false">☆</button></div><button class="open-map" aria-label="Explore sample ${record.id}"><canvas aria-hidden="true"></canvas></button><div class="sample-bottom"><div class="sample-stats"><span><strong>${percent(s.forest)}</strong>woodland</span><span><strong>${percent(s.desert)}</strong>desert</span><span><strong>${percent(s.relief)}</strong>raised land</span></div><div class="sample-note"><span><b>${s.lakeCount}</b> lakes · <b>${s.mountainBodies}</b> mountain bodies</span><span><b>${Math.round(s.minimumStartDistance)}</b> tile spacing</span></div></div>`;
  const canvas = card.querySelector('canvas')!; drawCard(canvas, record);
  card.querySelector('.favorite-button')!.addEventListener('click', () => toggleFavorite(record));
  card.querySelector('.open-map')!.addEventListener('click', event => {
    const e = event as MouseEvent, rect = canvas.getBoundingClientRect();
    const point = e.detail ? { x: (e.clientX - rect.left) / rect.width * record.width, y: (e.clientY - rect.top) / rect.height * record.height } : undefined;
    void openRecord(record, point);
  });
  $('#gallery').append(card); updateFavorites();
}
function config(record = selected) {
  if (!record) throw new Error('Choose a sample first.');
  return { sample: record.id, title: record.title, seed: record.seed, width: record.width, height: record.height, style: 'fractal' as const, parameters: { ...record.parameters } };
}
function writeSettings(record: SampleRecord): void {
  const s = record.summary;
  $('#selected-metrics').textContent = `${percent(s.land)} land · ${s.compactLakes} / ${s.lakeCount} compact lakes. Closest capitals: ${s.minimumStartDistance.toFixed(1)} tiles; mean nearest neighbor: ${s.meanStartDistance.toFixed(1)} tiles.`;
  $('#settings').replaceChildren(); let group = '';
  for (const [name, control] of Object.entries(LANDSCAPE_CONTROLS)) {
    if (group !== control.group) { group = control.group; const h = document.createElement('h3'); h.textContent = group; $('#settings').append(h); }
    const row = document.createElement('div'); row.className = 'setting'; row.title = `Supported range: ${control.min}–${control.max}`;
    const label = document.createElement('span'); label.textContent = control.label;
    const value = document.createElement('output'); value.textContent = String(record.parameters[name as LandscapeParameter]); row.append(label, value); $('#settings').append(row);
  }
  $('#latitude-bars').innerHTML = `<span></span><span>Woodland</span><span>Desert</span>${['North', 'Middle', 'South'].map((name, i) => `<span>${name}</span><div class="bar" style="--fill:${percent(s.latitudeForest[i])};--color:#577447"><span>${percent(s.latitudeForest[i])}</span></div><div class="bar" style="--fill:${percent(s.latitudeDesert[i])};--color:#9b864c"><span>${percent(s.latitudeDesert[i])}</span></div>`).join('')}`;
  $('#export-notice').textContent = '';
}
function remember(record: SampleRecord, generated: World): void {
  const key = cacheKey(record); worldCache.delete(key); worldCache.set(key, generated);
  if (worldCache.size > 3) worldCache.delete(worldCache.keys().next().value!);
}
async function openRecord(record: SampleRecord, point?: { x: number; y: number }): Promise<void> {
  const token = ++selectionToken; selected = record; world = undefined;
  mountainCursor = -1; mountainFocus = '';
  $('#detail-title').textContent = `${record.id} · ${record.title}`; $('#detail-subtitle').textContent = `Fractal · ${record.seed}`;
  writeSettings(record); updateFavorites(); if (!dialog.open) dialog.showModal(); $('#view-loading').hidden = false;
  try {
    await pause(); const generated = worldCache.get(cacheKey(record)) ?? generateWorld(record.seed, record.width, record.height, { style: 'fractal', parameters: record.parameters });
    if (token !== selectionToken) return;
    world = generated; remember(record, world); center = point ?? { ...world.spawns[0] }; zoom = point ? 20 : 18;
    $('#view-loading').hidden = true; scheduleDraw();
  } catch (error) { $('#view-loading').textContent = `Could not generate this sample: ${String(error)}`; console.error(error); }
}
function drawWoodland(c: CanvasRenderingContext2D, w: World, ox: number, oy: number, left: number, top: number, right: number, bottom: number): void {
  if (!$<HTMLInputElement>('#show-woodland').checked) return;
  for (let y = top; y < Math.min(w.height, bottom + 1); y++) for (let x = left; x < right; x++) {
    const tile = w.tiles[y * w.width + x]; if (tile.stair || ridgeIsLedge(w, x, y)) continue;
    const sprite = vegetationVariant(tile); if (!sprite) continue;
    const h = zoom * sprite.height / 16;
    c.drawImage(trees, sprite.x, sprite.y, sprite.width, sprite.height, Math.round(ox + x * zoom), Math.round(oy + (y + 1) * zoom - h), zoom, h);
  }
}
function drawDetail(): void {
  pending = false; if (!world || !selected || !dialog.open) return;
  const bounds = detail.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  detail.width = Math.round(bounds.width * dpr); detail.height = Math.round(bounds.height * dpr);
  const c = detail.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.imageSmoothingEnabled = false;
  c.fillStyle = '#10231d'; c.fillRect(0, 0, bounds.width, bounds.height);
  center.x = Math.max(0, Math.min(world.width, center.x)); center.y = Math.max(0, Math.min(world.height, center.y));
  const ox = bounds.width / 2 - center.x * zoom, oy = bounds.height / 2 - center.y * zoom;
  const left = Math.max(0, Math.floor(-ox / zoom)), top = Math.max(0, Math.floor(-oy / zoom));
  const right = Math.min(world.width, Math.ceil((bounds.width - ox) / zoom)), bottom = Math.min(world.height, Math.ceil((bounds.height - oy) / zoom));
  if (zoom < 7) {
    const low = document.createElement('canvas'); low.width = world.width; low.height = world.height;
    const context = low.getContext('2d')!, data = context.createImageData(world.width, world.height); data.data.set(overviewPixels(world)); context.putImageData(data, 0, 0);
    c.drawImage(low, ox, oy, world.width * zoom, world.height * zoom);
  } else if (right > left && bottom > top) {
    const raster = rasterTerrain(world, { x: left, y: top, width: right - left, height: bottom - top }, atlas, desertAtlas);
    const low = document.createElement('canvas'); low.width = raster.width; low.height = raster.height;
    const context = low.getContext('2d')!, data = context.createImageData(raster.width, raster.height); data.data.set(raster.pixels); context.putImageData(data, 0, 0);
    c.drawImage(low, ox + left * zoom, oy + top * zoom, (right - left) * zoom, (bottom - top) * zoom);
    drawWoodland(c, world, ox, oy, left, top, right, bottom);
    c.lineWidth = 1.5; c.lineCap = 'round';
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const tile = world.tiles[y * world.width + x], sx = ox + (x + .5) * zoom, sy = oy + (y + .5) * zoom;
      if (tile.mountainPass) { c.fillStyle = '#f0d99f'; c.fillRect(sx - 1.5, sy - 1.5, 3, 3); }
      if (tile.stair) {
        const up = STAIR_UP[tile.stair], d = zoom * .24, s = zoom * .12;
        const arrow = () => { c.beginPath(); c.moveTo(sx - up.x * d, sy - up.y * d); c.lineTo(sx + up.x * d, sy + up.y * d); c.moveTo(sx - up.y * s, sy + up.x * s); c.lineTo(sx + up.x * d, sy + up.y * d); c.lineTo(sx + up.y * s, sy - up.x * s); c.stroke(); };
        c.strokeStyle = '#172016'; c.lineWidth = 3.5; arrow(); c.strokeStyle = '#fff2c6'; c.lineWidth = 1.3; arrow();
      }
    }
  }
  if ($<HTMLInputElement>('#show-grid').checked && zoom >= 7) {
    c.strokeStyle = '#16211238'; c.lineWidth = 1; c.beginPath();
    for (let x = left; x <= right; x++) { c.moveTo(ox + x * zoom, oy + top * zoom); c.lineTo(ox + x * zoom, oy + bottom * zoom); }
    for (let y = top; y <= bottom; y++) { c.moveTo(ox + left * zoom, oy + y * zoom); c.lineTo(ox + right * zoom, oy + y * zoom); } c.stroke();
  }
  markers(c, selected, ox, oy, zoom); $('#view-tag').textContent = zoom < 7 ? 'N ↑ · Overview · Zoom in for tile art' : mountainFocus || 'N ↑ · Native terrain art · Ramps point uphill';
}
function scheduleDraw(): void { if (!pending) { pending = true; requestAnimationFrame(drawDetail); } }
function zoomTo(value: number): void { zoom = Math.max(1.5, Math.min(64, value)); scheduleDraw(); }
function find(kind: 'mountains' | 'lake' | 'start'): void {
  if (!world) return;
  mountainFocus = '';
  if (kind === 'mountains') {
    const groups = new Map<number, number[]>();
    world.tiles.forEach((tile, index) => {
      if (!tile.ridge || tile.relief !== 'mountains') return;
      const cells = groups.get(tile.ridge) ?? []; cells.push(index); groups.set(tile.ridge, cells);
    });
    const bodies = [...groups].map(([id, cells]) => {
      const xs = cells.map(cell => cell % world!.width), ys = cells.map(cell => Math.floor(cell / world!.width));
      const left = Math.min(...xs), top = Math.min(...ys), width = Math.max(...xs) - left + 1, height = Math.max(...ys) - top + 1;
      return { id, left, top, width, height, aspect: Math.max(width, height) / Math.min(width, height), area: cells.length };
    });
    // Alternate elongated and compact bodies, then small and large ones. A
    // cell-weighted median tends to keep returning the same largest massif.
    const elongated = [...bodies].sort((a, b) => b.aspect - a.aspect || b.area - a.area);
    const compact = [...bodies].sort((a, b) => a.aspect - b.aspect || b.area - a.area);
    const small = [...bodies].sort((a, b) => a.area - b.area), large = [...bodies].sort((a, b) => b.area - a.area);
    const order = [elongated[0], compact[0], small[0], large[0], ...bodies].filter((body, index, all) => body && all.findIndex(other => other?.id === body.id) === index);
    if (order.length) {
      mountainCursor = (mountainCursor + 1) % order.length; const body = order[mountainCursor];
      center = { x: body.left + body.width / 2, y: body.top + body.height / 2 };
      const bounds = detail.getBoundingClientRect(); zoom = Math.min(32, Math.max(8, Math.min(bounds.width / (body.width + 10), bounds.height / (body.height + 10))));
      mountainFocus = `Mountain ${mountainCursor + 1}/${order.length} · ${body.width} × ${body.height} tiles · Mountains ↻ cycles`;
      $('#tile-info').textContent = 'Click Mountains again to compare another length and shape.'; scheduleDraw(); return;
    }
  }
  const candidates = world.tiles.flatMap((tile, index) => kind === 'mountains' ? tile.ridge && tile.relief === 'mountains' ? [index] : [] : tile.terrain === 'lake' ? [index] : []);
  const i = candidates[Math.floor(candidates.length / 2)];
  center = kind === 'start' || i === undefined ? { ...world.spawns[0] } : { x: i % world.width + .5, y: Math.floor(i / world.width) + .5 }; zoom = 24; scheduleDraw();
}
function downloadSelected(): void {
  const blob = new Blob([JSON.stringify(config(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `fractal-sample-${selected!.id}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('#export-notice').textContent = 'Exact seed and all settings exported.';
}
async function recordFrom(sample: Sample): Promise<SampleRecord> {
  await pause(); const generated = generateWorld(sample.seed, undefined, undefined, { style: 'fractal', parameters: sample.parameters });
  const canvas = document.createElement('canvas'); canvas.width = generated.width; canvas.height = generated.height;
  const c = canvas.getContext('2d')!, pixels = c.createImageData(generated.width, generated.height); pixels.data.set(overviewPixels(generated)); c.putImageData(pixels, 0, 0);
  const record = { ...sample, width: generated.width, height: generated.height, summary: measure(generated), capitals: generated.spawns, secondary: generated.secondarySpawns ?? [], preview: canvas.toDataURL() };
  remember(record, generated); return record;
}
async function regenerate(): Promise<void> {
  const token = ++generation, seed = $<HTMLInputElement>('#seed').value.trim() || GALLERY_SEED;
  $<HTMLInputElement>('#seed').value = seed; document.documentElement.dataset.ready = 'false';
  records = []; images.clear(); worldCache.clear(); $('#gallery').replaceChildren(); $('#status').classList.remove('error');
  $<HTMLButtonElement>('#regenerate').disabled = true; $<HTMLButtonElement>('#import-button').disabled = true;
  const progress = $<HTMLProgressElement>('#progress'); progress.hidden = false; progress.value = 0;
  try {
    for (const sample of sampleSettings(seed)) {
      $('#status').textContent = `Generating sample ${sample.id} of 25…`; const record = await recordFrom(sample);
      if (token !== generation) return; records.push(record); await addCard(record); progress.value = records.length;
    }
    $('#status').textContent = `25 worlds ready · Same seed: ${seed} · ${Object.keys(LANDSCAPE_CONTROLS).length} varied landscape settings per sample.`;
    document.documentElement.dataset.ready = 'true';
  } catch (error) { $('#status').textContent = `Generation failed: ${String(error)}`; $('#status').classList.add('error'); console.error(error); }
  finally { progress.hidden = true; $<HTMLButtonElement>('#regenerate').disabled = false; $<HTMLButtonElement>('#import-button').disabled = false; }
}
$('#seed-form').onsubmit = event => { event.preventDefault(); void regenerate(); };
$('#show-starts').onchange = $('#show-equator').onchange = () => { document.querySelectorAll<HTMLCanvasElement>('.open-map canvas').forEach(canvas => drawCard(canvas, records.find(record => record.id === canvas.closest<HTMLElement>('.sample')!.dataset.id)!)); scheduleDraw(); };
$('#favorites-only').onchange = updateFavorites;
$('#close').onclick = () => dialog.close(); $('#detail-favorite').onclick = () => { if (selected) toggleFavorite(selected); };
$('#zoom-in').onclick = () => zoomTo(zoom * 1.4); $('#zoom-out').onclick = () => zoomTo(zoom / 1.4);
$('#fit').onclick = () => { if (!world) return; const bounds = detail.getBoundingClientRect(); center = { x: world.width / 2, y: world.height / 2 }; zoomTo(Math.min(bounds.width / world.width, bounds.height / world.height) * .96); };
$('#find-mountains').onclick = () => find('mountains'); $('#find-lake').onclick = () => find('lake'); $('#find-start').onclick = () => find('start');
$('#show-woodland').onchange = $('#show-grid').onchange = scheduleDraw;
$('#download').onclick = downloadSelected;
$('#copy').onclick = async () => {
  const text = JSON.stringify(config(), null, 2);
  try { await navigator.clipboard.writeText(text); $('#export-notice').textContent = 'Seed and all settings copied.'; }
  catch { downloadSelected(); $('#export-notice').textContent = 'Clipboard unavailable; settings downloaded instead.'; }
};
$('#import-button').onclick = () => $<HTMLInputElement>('#import-file').click();
$<HTMLInputElement>('#import-file').onchange = async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.style !== 'fractal' || typeof data.seed !== 'string' || !data.seed || typeof data.parameters !== 'object' || !data.parameters) throw new Error('Expected a Fractal sample with a seed and landscape settings.');
    const record = await recordFrom({ id: 'Imported', title: 'Saved configuration', seed: data.seed, parameters: resolveLandscapeParameters(data.parameters) });
    await openRecord(record); $('#export-notice').textContent = 'Imported configuration reproduced.';
  } catch (error) { $('#status').textContent = `Import failed: ${String(error)}`; $('#status').classList.add('error'); }
  input.value = '';
};
detail.onwheel = event => { event.preventDefault(); zoomTo(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)); };
detail.onpointerdown = event => { if (event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, cx: center.x, cy: center.y }; detail.setPointerCapture(event.pointerId); };
detail.onpointerup = detail.onpointercancel = () => { drag = undefined; };
detail.onpointermove = event => {
  if (!world) return;
  if (drag) { center = { x: drag.cx - (event.clientX - drag.x) / zoom, y: drag.cy - (event.clientY - drag.y) / zoom }; scheduleDraw(); }
  const bounds = detail.getBoundingClientRect(), x = Math.floor(center.x + (event.clientX - bounds.left - bounds.width / 2) / zoom), y = Math.floor(center.y + (event.clientY - bounds.top - bounds.height / 2) / zoom);
  const tile = x >= 0 && y >= 0 && x < world.width && y < world.height ? world.tiles[y * world.width + x] : undefined;
  if (!tile) return;
  $('#tile-info').textContent = `${x}, ${y} · ${tile.terrain} · ${tile.stair ? `Ramp uphill ${tile.stair}` : tile.mountainPass ? 'Mountain pass' : ridgeIsLedge(world, x, y) ? 'Impassable cliff' : tile.ridge ? `Upper ground · level ${ridgeLevel(tile)}` : WATER.has(tile.terrain) ? 'Water' : 'Low ground'}${tile.overlay === 'forest' ? ' · Woodland' : ''}`;
  if (tile.biome) $('#tile-info').textContent += ` · ${BIOME_NAMES[tile.biome]}`;
  if (tile.fertility !== undefined && !WATER.has(tile.terrain)) $('#tile-info').textContent += ` · Soil ${Math.round(tile.fertility * 100)}%`;
  if (tile.resource) $('#tile-info').textContent += ` · ${RESOURCE_NAMES[tile.resource]}`;
};
new ResizeObserver(scheduleDraw).observe(detail.parentElement!);
Object.assign(window, { __fractalGallery: { get records() { return records; }, get selected() { return selected; }, get world() { return world; }, get zoom() { return zoom; }, get center() { return center; }, openRecord, config, sampleSettings, regenerate } });
try {
  trees = new Image(); trees.src = payload.FRACTAL_GALLERY_ASSETS.vegetation;
  [atlas, desertAtlas] = await Promise.all([imagePixels(payload.FRACTAL_GALLERY_ASSETS.world), imagePixels(payload.FRACTAL_GALLERY_ASSETS.desert)]); await trees.decode();
  for (const record of records) await addCard(record);
  $('#status').textContent = `25 worlds ready · Same seed: ${records[0]?.seed ?? GALLERY_SEED} · ${Object.keys(LANDSCAPE_CONTROLS).length} varied landscape settings per sample.`;
  document.documentElement.dataset.ready = 'true';
} catch (error) { $('#status').textContent = `Unable to open gallery: ${String(error)}`; $('#status').classList.add('error'); console.error(error); }
