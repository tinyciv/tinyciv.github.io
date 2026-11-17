import './ui/game-font.css';
import './ui/world-viewer.css';
import { loadGameAssets } from './game/game-assets';
import { loadGameFonts } from './game/game-font';
import { setMapRevealed } from './game/fog';
import { BIOME_NAMES, RESOURCE_NAMES } from './game/geography';
import { Renderer, MAX_ZOOM } from './game/renderer';
import { createGame } from './game/simulation';
import { TILE_SIZE, WATER, type GameState, type Point } from './game/types';
import { generateWorldAsync } from './world/generator';
import { LANDSCAPE_CONTROLS, LANDFORM_NAMES, resolveLandscapeParameters, type LandscapeParameter, type LandscapeParameters, type LandformFamily } from './world/options';
import { AGES, CLIMATES, LAND_MASSES, TEMPERATURES, WORLD_SIZES, initialWorldSetup, newGameOptions, type WorldSetup } from './ui/world-generation';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const freshSeed = () => `World-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
const presets: Record<string, { label: string; settings: Partial<WorldSetup> }> = {
  standard: { label: 'Continents', settings: {} },
  archipelago: { label: 'Archipelago', settings: { landmass: 'archipelago' } },
  pangaea: { label: 'Pangaea', settings: { landmass: 'pangaea' } },
  warm: { label: 'Warm climate', settings: { temperature: 0 } },
  cool: { label: 'Cool climate', settings: { temperature: 2 } },
  arid: { label: 'Arid climate', settings: { climate: 0 } },
  wet: { label: 'Wet climate', settings: { climate: 2 } },
  young: { label: 'Young world', settings: { age: 0 } },
  old: { label: 'Old world', settings: { age: 2 } },
  custom: { label: 'Custom', settings: {} },
};
const presetControls = [
  { setting: 'water', neutral: 70, keys: ['landScale'] },
  { setting: 'age', neutral: 1, keys: ['reliefCoverage', 'mountainShare', 'hillClustering'] },
  { setting: 'climate', neutral: 1, keys: ['moisture', 'desertThreshold', 'forestThreshold'] },
  { setting: 'temperature', neutral: 1, keys: ['equatorWidth', 'latitudeInfluence'] },
] as const;
const options = (choices: readonly { value: string; label: string }[]) => choices.map(choice => `<option value="${escape(choice.value)}">${escape(choice.label)}</option>`).join('');
const indexedOptions = (choices: readonly string[]) => options(choices.map((label, index) => ({ value: String(index), label })));
const parameterGroups = new Map<string, LandscapeParameter[]>();
for (const key of Object.keys(LANDSCAPE_CONTROLS) as LandscapeParameter[]) {
  if (LANDSCAPE_CONTROLS[key].group === 'World') continue;
  const group = LANDSCAPE_CONTROLS[key].group;
  parameterGroups.set(group, [...(parameterGroups.get(group) ?? []), key]);
}

$('#app').innerHTML = `
<main class="viewer">
  <header class="viewer-header"><h1>TinyCiv · World viewer</h1><output id="world-summary"></output></header>
  <aside class="viewer-settings" aria-label="World generation settings">
    <form id="world-settings">
      <label>World type<select id="preset">${options(Object.entries(presets).map(([value, preset]) => ({ value, label: preset.label })))}</select></label>
      <label>Seed<input id="seed" maxlength="160" autocomplete="off" required /></label>
      <label>Size<select id="size">${options(WORLD_SIZES.map(size => ({ value: size.id, label: `${size.label} · ${size.width}×${size.height}` })))}</select></label>
      <label>Landmass<select id="landmass">${options(LAND_MASSES.map(mass => ({ value: mass.id, label: mass.label })))}</select></label>
      <div class="viewer-pair">
        <label>Climate<select id="climate">${indexedOptions(CLIMATES)}</select></label>
        <label>Temperature<select id="temperature">${indexedOptions(TEMPERATURES)}</select></label>
      </div>
      <div class="viewer-pair">
        <label>Water<select id="water">${options([60, 70, 80].map(value => ({ value: String(value), label: `${value}%` })))}</select></label>
        <label>Age<select id="age">${indexedOptions(AGES)}</select></label>
      </div>
      <label>Landforms<select id="landforms">${options(Object.entries(LANDFORM_NAMES).map(([value, label]) => ({ value, label })))}</select></label>
      <label><input type="checkbox" id="deltas" checked />River deltas</label>
      <div class="viewer-actions"><button type="submit">Regenerate</button><button type="button" id="new-seed">New seed</button></div>
      <details><summary>Landscape controls</summary><div>${[...parameterGroups].map(([group, keys]) => `
        <details><summary>${group}</summary><div>${keys.map(key => {
          const control = LANDSCAPE_CONTROLS[key];
          return `<label>${control.label}<input type="number" data-parameter="${key}" min="${control.min}" max="${control.max}" step="any" value="${control.default}" /></label>`;
        }).join('')}</div></details>`).join('')}</div></details>
      <h2>View</h2>
      <label><input type="checkbox" id="overlays" />City labels & alerts</label>
      <label><input type="checkbox" id="grid" />Tile grid</label>
    </form>
    <canvas id="overview" class="viewer-minimap" aria-label="World overview. Click to center camera."></canvas>
  </aside>
  <section class="viewer-stage" aria-label="Revealed world">
    <canvas id="world-view" tabindex="0" aria-label="World terrain. Drag to pan, scroll to zoom, F to fit the map, arrow keys to pan."></canvas>
    <div class="viewer-tools" aria-label="Camera"><button type="button" id="fit">Fit map</button><button type="button" id="zoom-out" aria-label="Zoom out">−</button><button type="button" id="zoom-in" aria-label="Zoom in">+</button><output id="zoom"></output></div>
    <output id="tile-inspection" class="viewer-inspection"></output>
    <div id="loading" class="viewer-loading" role="progressbar" aria-label="World generation" aria-valuemin="0" aria-valuemax="100"><span class="viewer-spinner" aria-hidden="true"></span><span id="progress">0%</span></div>
    <div id="error" class="viewer-error" role="alert" hidden></div>
  </section>
</main>`;

const canvas = $<HTMLCanvasElement>('#world-view');
const renderer = new Renderer(canvas, $<HTMLCanvasElement>('#overview'));
renderer.follow = false;
renderer.overlays = false;
let state: GameState | undefined;
let busy = false, assetsLoaded = false, drawing = false, fit = true;
let drag: { id: number; x: number; y: number; camera: Point } | undefined;
const touches = new Map<number, Point>();
let pinch: { distance: number; zoom: number; anchor: Point } | undefined;
const form = $<HTMLFormElement>('#world-settings');
const value = (id: string) => $<HTMLInputElement | HTMLSelectElement>(`#${id}`).value;
const setValue = (id: string, next: string | number) => { $<HTMLInputElement | HTMLSelectElement>(`#${id}`).value = String(next); };
const checked = (id: string) => $<HTMLInputElement>(`#${id}`).checked;
const setupIds = ['size', 'landmass', 'climate', 'temperature', 'age', 'water'] as const;
function setup(): WorldSetup {
  return { ...initialWorldSetup(), size: value('size'), landmass: value('landmass') as WorldSetup['landmass'],
    climate: Number(value('climate')), temperature: Number(value('temperature')), age: Number(value('age')), water: Number(value('water')), barbarians: 0 };
}
function generationOptions() {
  return newGameOptions({ seed: value('seed'), style: 'continents', landformFamily: value('landforms') as LandformFamily }, setup());
}
function parameters(): Partial<LandscapeParameters> {
  const result = { ...generationOptions().parameters };
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-parameter][data-edited]')) {
    if (input.value && input.validity.valid) result[input.dataset.parameter as LandscapeParameter] = Number(input.value);
  }
  return result;
}
function refreshParameterInputs(): void {
  const effective = resolveLandscapeParameters(parameters());
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-parameter]')) input.value = String(effective[input.dataset.parameter as LandscapeParameter]);
}
function applyPreset(id: string): void {
  const next = { ...initialWorldSetup(), ...presets[id]?.settings };
  for (const key of setupIds) setValue(key, next[key]);
  setValue('landforms', 'mixed');
  $<HTMLInputElement>('#deltas').checked = true;
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-parameter]')) {
    input.value = String(LANDSCAPE_CONTROLS[input.dataset.parameter as LandscapeParameter].default);
    delete input.dataset.edited;
  }
  refreshParameterInputs();
}

const query = new URLSearchParams(location.search);
const initialPreset = query.get('preset') ?? 'standard';
setValue('preset', Object.hasOwn(presets, initialPreset) ? initialPreset : 'standard');
applyPreset(value('preset'));
setValue('seed', query.get('seed')?.slice(0, 160) || freshSeed());
for (const id of [...setupIds, 'landforms']) {
  const requested = query.get(id);
  const select = $<HTMLSelectElement>(`#${id}`);
  if (requested && Array.from(select.options).some(option => option.value === requested)) select.value = requested;
}
if (query.get('deltas') === 'false') $<HTMLInputElement>('#deltas').checked = false;
for (const input of document.querySelectorAll<HTMLInputElement>('[data-parameter]')) {
  const key = input.dataset.parameter as LandscapeParameter, raw = query.get(`p.${key}`);
  if (raw === null) continue;
  const number = Number(raw), control = LANDSCAPE_CONTROLS[key];
  if (Number.isFinite(number) && number >= control.min && number <= control.max) {
    input.value = raw; input.dataset.edited = 'true';
  }
}
refreshParameterInputs();

function progress(amount: number): void {
  const percent = Math.round(amount * 100);
  $('#progress').textContent = `${percent}%`;
  $('#loading').setAttribute('aria-valuenow', String(percent));
}
let loaded = 0;
const assets = loadGameAssets(renderer);
const ready = Promise.all(assets.map(asset => asset.then(() => progress(.25 * ++loaded / assets.length)))).then(() => { assetsLoaded = true; });
// Keep failures handled while fonts finish loading before the first generation.
void ready.catch(() => {});

function fitZoom(): number {
  if (!state) return .1;
  return Math.min((renderer.width - 32) / (state.world.width * TILE_SIZE), (renderer.height - 32) / (state.world.height * TILE_SIZE));
}
function centerWorld(): void {
  if (!state) return;
  renderer.zoom = Math.max(.001, fitZoom());
  renderer.camera = { x: state.world.width / 2, y: state.world.height / 2 };
  fit = true; draw();
}
function draw(): void {
  if (!state || drawing) return;
  drawing = true;
  requestAnimationFrame(() => {
    drawing = false;
    if (!state) return;
    renderer.draw(state, 0);
    $('#zoom').textContent = `${Math.round(renderer.zoom * 100)}%`;
    document.documentElement.dataset.worldViewer = 'ready';
  });
}
function zoom(next: number, anchor?: Point): void {
  if (!state) return;
  const before = anchor && renderer.worldPoint(anchor.x, anchor.y);
  renderer.zoom = Math.min(MAX_ZOOM, Math.max(Math.max(.001, fitZoom() / 4), next));
  if (anchor && before) {
    const after = renderer.worldPoint(anchor.x, anchor.y);
    renderer.camera.x += before.x - after.x; renderer.camera.y += before.y - after.y;
  }
  fit = false; draw();
}
function updateLocation(parameters: Partial<LandscapeParameters>): void {
  const params = new URLSearchParams({ preset: value('preset'), seed: value('seed'), landforms: value('landforms'), deltas: String(checked('deltas')) });
  for (const id of setupIds) params.set(id, value(id));
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-parameter][data-edited]')) {
    const key = input.dataset.parameter as LandscapeParameter;
    params.set(`p.${key}`, String(parameters[key]));
  }
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
async function regenerate(): Promise<void> {
  if (busy || !form.reportValidity()) return;
  busy = true;
  document.documentElement.dataset.worldViewer = 'loading';
  $('#error').hidden = true; $('#loading').hidden = false; progress(0);
  const controls = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')];
  controls.forEach(control => { control.disabled = true; });
  try {
    const hadAssets = assetsLoaded;
    await ready;
    const seed = value('seed').trim() || freshSeed(); setValue('seed', seed);
    const selected = generationOptions(), selectedParameters = parameters();
    const start = hadAssets ? 0 : .25;
    let completed = start;
    const world = await generateWorldAsync(seed, selected.width, selected.height, { style: selected.style, landformFamily: selected.landformFamily, parameters: selectedParameters, riverDeltas: checked('deltas') }, update => {
      completed = Math.max(completed, start + (.9 - start) * update.progress); progress(completed);
    });
    progress(.9);
    await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const next = createGame(world, undefined, { banditIntensity: 0 });
    next.paused = true;
    setMapRevealed(next, true);
    state = next;
    renderer.overlays = checked('overlays'); renderer.showGrid = checked('grid');
    // One census per generated world; inspection and camera changes do not rescan it.
    let land = 0, hills = 0, rivers = 0;
    for (const tile of world.tiles) {
      land += Number(!WATER.has(tile.terrain)); hills += Number(!!tile.relief);
      rivers += Number(tile.terrain === 'river' || !!tile.creek);
    }
    $('#world-summary').textContent = `${world.width}×${world.height} · ${Math.round(land / world.tiles.length * 100)}% land · ${hills} relief · ${rivers} river tiles`;
    $('#tile-inspection').textContent = '';
    updateLocation(selectedParameters);
    centerWorld(); progress(1);
    $('#loading').hidden = true;
    document.documentElement.dataset.assets = 'ready';
  } catch (error) {
    $('#loading').hidden = true; $('#error').hidden = false;
    $('#error').textContent = `World generation failed: ${error instanceof Error ? error.message : String(error)}`;
    document.documentElement.dataset.worldViewer = 'error';
    if (!state) document.documentElement.dataset.assets = 'error';
    console.error(error);
  } finally {
    busy = false; controls.forEach(control => { control.disabled = false; });
  }
}

form.onsubmit = event => { event.preventDefault(); void regenerate(); };
$('#new-seed').onclick = () => { setValue('seed', freshSeed()); void regenerate(); };
$('#preset').onchange = () => { if (value('preset') !== 'custom') { applyPreset(value('preset')); void regenerate(); } };
for (const id of [...setupIds, 'landforms', 'deltas']) $(`#${id}`).onchange = () => { setValue('preset', 'custom'); refreshParameterInputs(); };
for (const input of document.querySelectorAll<HTMLInputElement>('[data-parameter]')) input.oninput = () => {
  if (!input.validity.valid || !input.value) return;
  const key = input.dataset.parameter as LandscapeParameter;
  // Editing a preset-owned control makes that setting custom. Preserve its
  // siblings' effective values, so changing one number changes only that number.
  for (const owner of presetControls) if ((owner.keys as readonly string[]).includes(key) && Number(value(owner.setting)) !== owner.neutral) {
    for (const sibling of owner.keys) $<HTMLInputElement>(`[data-parameter="${sibling}"]`).dataset.edited = 'true';
    setValue(owner.setting, owner.neutral);
  }
  input.dataset.edited = 'true'; setValue('preset', 'custom');
};
$('#fit').onclick = centerWorld;
$('#zoom-in').onclick = () => zoom(renderer.zoom * 1.25);
$('#zoom-out').onclick = () => zoom(renderer.zoom / 1.25);
$('#overlays').onchange = () => { renderer.overlays = checked('overlays'); draw(); };
$('#grid').onchange = () => { renderer.showGrid = checked('grid'); draw(); };
canvas.addEventListener('wheel', event => {
  event.preventDefault(); zoom(renderer.zoom * Math.exp(-event.deltaY * (event.deltaMode === 1 ? .04 : .0015)), { x: event.clientX, y: event.clientY });
}, { passive: false });
canvas.oncontextmenu = event => event.preventDefault();
function beginPinch(): void {
  const [a, b] = [...touches.values()];
  if (!a || !b) { pinch = undefined; return; }
  const anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: renderer.zoom, anchor: renderer.worldPoint(anchor.x, anchor.y) };
  drag = undefined;
}
canvas.onpointerdown = event => {
  if (!state || busy) return;
  canvas.focus(); canvas.setPointerCapture(event.pointerId);
  touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...renderer.camera } };
  if (touches.size > 1) beginPinch();
  canvas.classList.add('is-dragging');
};
canvas.onpointermove = event => {
  if (!state) return;
  if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && touches.size > 1) {
    const [a, b] = [...touches.values()];
    zoom(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance);
    const current = renderer.worldPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
    renderer.camera.x += pinch.anchor.x - current.x; renderer.camera.y += pinch.anchor.y - current.y;
    draw();
  } else if (drag?.id === event.pointerId) {
    renderer.camera = { x: drag.camera.x - (event.clientX - drag.x) / (TILE_SIZE * renderer.zoom), y: drag.camera.y - (event.clientY - drag.y) / (TILE_SIZE * renderer.zoom) };
    fit = false; draw();
  }
  const point = renderer.worldPoint(event.clientX, event.clientY), x = Math.floor(point.x), y = Math.floor(point.y);
  const tile = x >= 0 && y >= 0 && x < state.world.width && y < state.world.height ? state.world.tiles[y * state.world.width + x] : undefined;
  $('#tile-inspection').textContent = tile ? [`${x}, ${y}`, tile.biome && BIOME_NAMES[tile.biome], tile.terrain, tile.overlay !== 'none' && tile.overlay, tile.resource && RESOURCE_NAMES[tile.resource], tile.relief, tile.stair && 'Stair'].filter(Boolean).join(' · ') : '';
};
function release(event: PointerEvent): void {
  touches.delete(event.pointerId);
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (drag?.id === event.pointerId) drag = undefined;
  beginPinch();
  if (touches.size === 1) {
    const [id, point] = [...touches][0];
    drag = { id, x: point.x, y: point.y, camera: { ...renderer.camera } };
  }
  if (!touches.size) canvas.classList.remove('is-dragging');
}
canvas.onpointerup = release; canvas.onpointercancel = release;
canvas.onpointerleave = () => { $('#tile-inspection').textContent = ''; };
$('#overview').onpointerdown = event => {
  const point = renderer.minimapWorldPoint(event.clientX, event.clientY);
  if (point) { renderer.camera = point; fit = false; draw(); }
};
canvas.onkeydown = event => {
  if (!state) return;
  if (event.key.toLowerCase() === 'f') { event.preventDefault(); centerWorld(); return; }
  if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); zoom(renderer.zoom * (event.key === '-' ? .8 : 1.25)); return; }
  const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 } };
  const direction = directions[event.key];
  if (direction) { event.preventDefault(); renderer.camera.x += direction.x * 48 / (TILE_SIZE * renderer.zoom); renderer.camera.y += direction.y * 48 / (TILE_SIZE * renderer.zoom); fit = false; draw(); }
};
new ResizeObserver(() => { renderer.resize(); if (fit) centerWorld(); else draw(); }).observe(canvas);
window.addEventListener('pagehide', () => renderer.destroy(), { once: true });
// Read-only inspection for the startup check; the viewer never advances gameplay.
if (import.meta.env.DEV) Object.assign(window, { __worldViewer: { get state() { return state; }, renderer } });
document.documentElement.dataset.assets = 'loading';
try { await loadGameFonts(); await regenerate(); }
catch (error) { $('#loading').hidden = true; $('#error').hidden = false; $('#error').textContent = String(error); document.documentElement.dataset.assets = 'error'; console.error(error); }
