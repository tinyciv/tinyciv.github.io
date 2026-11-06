import { generateWorld, seededRandom, terrainYields } from '../../src/world/generator';
import { buildReliefShowcase } from '../../src/world/regional-relief';
import { placeFreshwaterLakes } from '../../src/world/lakes';
import { rasterTerrain, terrainMinimapColor } from '../../src/game/terrain';
import { ridgeIsLedge, ridgeLevel, STAIR_UP } from '../../src/game/ridges';
import { WATER, type World, type Tile } from '../../src/game/types';
import type { PunyPixels } from '../../src/game/puny-world';
import type { WorldGenerationStyle } from '../../src/world/options';
import { vegetationVariant } from '../../src/game/vegetation-art';
import { applyTerrainEcology } from '../../src/world/terrain-ecology';
import { assignTreeClimate } from '../../src/world/tree-climate';
import { BIOME_NAMES, RESOURCE_NAMES } from '../../src/game/geography';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const modes: { id: WorldGenerationStyle; title: string; description: string }[] = [
  { id: 'continents', title: 'Continents', description: 'Substantial landmasses divided by open sea, with offshore islands.' },
  { id: 'pangaea', title: 'Pangaea', description: 'One dominant landmass. Inland terrain controls the routes between cities.' },
  { id: 'fractal', title: 'Fractal', description: 'Branching coastlines, broken peninsulas, and an irregular island fringe.' },
];
type Scene = { id: string; title: string; description: string; world: World; sample?: boolean };
const assets = (window as unknown as { WORLD_LAB_ASSETS: Record<string, string> }).WORLD_LAB_ASSETS;
let atlas: PunyPixels, desert: PunyPixels;
let vegetationAtlas: HTMLImageElement;
const scenes = new Map<string, Scene>();
let active: Scene, center = { x: 0, y: 0 }, zoom = 24, pendingDraw = false, generation = 0;
const detail = $<HTMLCanvasElement>('#detail');
let viewSize = { width: 1, height: 1 }, drag: { x: number; y: number; cx: number; cy: number } | undefined;
const pauseForPaint = () => new Promise<void>(resolve => setTimeout(resolve, 20));

async function imagePixels(url: string): Promise<PunyPixels> {
  const image = new Image(); image.src = url; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const c = canvas.getContext('2d', { willReadFrequently: true })!; c.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, data: c.getImageData(0, 0, image.width, image.height).data };
}

function stats(world: World) {
  let land = 0, lakes = 0, hills = 0, mountains = 0, stairs = 0, passes = 0, woods = 0, woodedHighGround = 0, woodedMountains = 0;
  for (const tile of world.tiles) {
    land += Number(!WATER.has(tile.terrain)); lakes += Number(tile.terrain === 'lake');
    hills += Number(tile.relief === 'hills'); mountains += Number(tile.relief === 'mountains');
    stairs += Number(!!tile.stair); passes += Number(!!tile.mountainPass);
    const wooded = tile.overlay === 'forest' || tile.overlay === 'jungle'; woods += Number(wooded);
    woodedHighGround += Number(wooded && !!tile.ridge && !tile.stair);
    woodedMountains += Number(wooded && !!tile.ridge && tile.relief === 'mountains' && !tile.stair);
  }
  return { land, lakes, hills, mountains, stairs, passes, woods, woodedHighGround, woodedMountains, landPercent: Math.round(100 * land / world.tiles.length) };
}

/** Geometry shown in the preview is measured from the actual generated cells. */
function hillShapes(world: World) {
  const ridges = new Map<number, number[]>();
  world.tiles.forEach((tile, index) => {
    if (tile.relief !== 'hills' || !tile.ridge) return;
    const cells = ridges.get(tile.ridge) ?? []; cells.push(index); ridges.set(tile.ridge, cells);
  });
  return [...ridges].map(([id, cells]) => {
    const xs = cells.map(cell => cell % world.width), ys = cells.map(cell => Math.floor(cell / world.width));
    const x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x + 1, height = Math.max(...ys) - y + 1;
    const occupied = new Set(cells), rows = Array.from({ length: height }, (_, dy) => Array.from({ length: width }, (_, dx) => occupied.has((y + dy) * world.width + x + dx) ? '1' : '0').join(''));
    return { id, x, y, width, height, cells: cells.length, rows, rectangular: cells.length === width * height,
      stairs: cells.filter(cell => world.tiles[cell].stair).length };
  });
}

function overview(canvas: HTMLCanvasElement, scene: Scene): void {
  const { world } = scene; canvas.width = world.width * 2; canvas.height = world.height * 2;
  const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false;
  for (let i = 0; i < world.tiles.length; i++) {
    const tile = world.tiles[i], x = i % world.width, y = Math.floor(i / world.width);
    const wooded = $<HTMLInputElement>('#show-vegetation').checked && (tile.overlay === 'forest' || tile.overlay === 'jungle');
    c.fillStyle = wooded ? (tile.ridge ? '#51613a' : tile.treeClass === 'dry' ? '#758143' : '#3e663b')
      : tile.terrain === 'lake' ? '#67d7d0' : tile.relief === 'mountains' ? (ridgeLevel(tile) === 2 ? '#aaab94' : '#7b7d71')
      : tile.relief === 'hills' && tile.ridge ? (tile.terrain === 'desert' ? '#958452' : '#5c7441') : terrainMinimapColor(world, x, y);
    c.fillRect(x * 2, y * 2, 2, 2);
    if (tile.mountainPass) { c.fillStyle = '#ebd19a'; c.fillRect(x * 2, y * 2, 2, 2); }
  }
  c.lineWidth = 1;
  for (const point of [...world.spawns, ...(world.secondarySpawns ?? [])]) {
    c.fillStyle = '#12221e'; c.fillRect(point.x * 2 - 2, point.y * 2 - 2, 5, 5);
    c.strokeStyle = '#fff0cb'; c.strokeRect(point.x * 2 - 2.5, point.y * 2 - 2.5, 6, 6);
  }
}

function featureCenter(world: World, kind: string): { x: number; y: number } {
  if (kind === 'spawn' && world.spawns.length) return { ...world.spawns[0] };
  const matches: number[] = [];
  for (let i = 0; i < world.tiles.length; i++) {
    const tile = world.tiles[i];
    if (kind === 'woods' ? !!tile.ridge && !tile.stair && (tile.overlay === 'forest' || tile.overlay === 'jungle') && !ridgeIsLedge(world, i % world.width, Math.floor(i / world.width))
      : kind === 'hills' ? tile.relief === 'hills' && !!tile.stair
      : kind === 'mountains' ? !!tile.mountainPass
      : kind === 'lake' ? tile.terrain === 'lake' : !!tile.ridge) matches.push(i);
  }
  if (!matches.length) {
    for (let i = 0; i < world.tiles.length; i++) if (!WATER.has(world.tiles[i].terrain)) matches.push(i);
  }
  const index = matches[Math.floor(matches.length / 2)] ?? Math.floor(world.tiles.length / 2);
  return { x: index % world.width + .5, y: Math.floor(index / world.width) + .5 };
}

function setActive(scene: Scene, point?: { x: number; y: number }): void {
  active = scene; center = point ?? featureCenter(scene.world, scene.id.includes('lake') ? 'lake' : scene.id.includes('mountain') ? 'mountains' : 'hills');
  document.querySelectorAll('.map-card,.feature').forEach(element => {
    const selected = (element as HTMLElement).dataset.scene === scene.id;
    element.classList.toggle('selected', selected); element.setAttribute('aria-pressed', String(selected));
  });
  $('#detail-title').textContent = scene.title; $('#detail-description').textContent = scene.description;
  $('#detail-kicker').textContent = scene.sample ? 'Generated terrain sample' : 'World pattern';
  updateCaption();
  document.querySelectorAll<HTMLButtonElement>('[data-jump]').forEach(button => {
    const kind = button.dataset.jump;
    button.disabled = kind === 'spawn' ? !scene.world.spawns.length : kind === 'woods' ? !scene.world.tiles.some(tile => !!tile.ridge && (tile.overlay === 'forest' || tile.overlay === 'jungle'))
      : kind === 'hills' ? !scene.world.tiles.some(tile => tile.relief === 'hills')
      : kind === 'lake' ? !scene.world.tiles.some(tile => tile.terrain === 'lake') : !scene.world.tiles.some(tile => tile.mountainPass);
  });
  scheduleDraw();
}

function updateCaption(): void {
  if (active) $('#view-caption').textContent = `${active.title} · ${active.sample ? 'Geometry sample' : $<HTMLInputElement>('#show-vegetation').checked ? 'Terrain & woodland' : 'Terrain only'}`;
}

/** Same source variant and ground footing as the production renderer. */
function drawWoodland(c: CanvasRenderingContext2D, world: World, ox: number, oy: number, size: number, left: number, top: number, right: number, bottom: number): void {
  if (!vegetationAtlas || !$<HTMLInputElement>('#show-vegetation').checked) return;
  c.imageSmoothingEnabled = false;
  for (let y = top; y < Math.min(world.height, bottom + 1); y++) for (let x = left; x < right; x++) {
    const tile = world.tiles[y * world.width + x];
    if (tile.stair || ridgeIsLedge(world, x, y)) continue;
    const sprite = vegetationVariant(tile); if (!sprite) continue;
    const h = size * sprite.height / 16;
    c.drawImage(vegetationAtlas, sprite.x, sprite.y, sprite.width, sprite.height,
      Math.round(ox + x * size), Math.round(oy + (y + 1) * size - h), size, h);
  }
}

function clampCenter(): void {
  if (!active) return;
  const padX = viewSize.width / zoom / 2, padY = viewSize.height / zoom / 2;
  const bound = (value: number, pad: number, size: number) => size > pad * 2 ? Math.max(pad, Math.min(size - pad, value)) : size / 2;
  center.x = bound(center.x, padX, active.world.width); center.y = bound(center.y, padY, active.world.height);
}

function drawAnnotations(c: CanvasRenderingContext2D, world: World, ox: number, oy: number, size: number, left: number, top: number, right: number, bottom: number): void {
  c.save(); c.lineWidth = 1.3;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const tile = world.tiles[y * world.width + x], sx = ox + (x + .5) * size, sy = oy + (y + .5) * size;
    if (tile.mountainPass) {
      c.fillStyle = '#f8d783'; c.strokeStyle = '#53442b'; c.beginPath(); c.arc(sx, sy, Math.max(1.2, size * .08), 0, Math.PI * 2); c.fill(); c.stroke();
    }
    if (!tile.stair) continue;
    const up = STAIR_UP[tile.stair], d = size * .25, side = size * .14;
    c.strokeStyle = '#192119'; c.lineWidth = 4; c.lineCap = 'round';
    const arrow = () => {
      c.beginPath(); c.moveTo(sx - up.x * d, sy - up.y * d); c.lineTo(sx + up.x * d, sy + up.y * d);
      c.moveTo(sx - up.y * side, sy + up.x * side); c.lineTo(sx + up.x * d, sy + up.y * d);
      c.lineTo(sx + up.y * side, sy - up.x * side); c.stroke();
    };
    arrow(); c.strokeStyle = '#fff9d5'; c.lineWidth = 1.5; arrow();
  }
  c.restore();
}

function drawDetail(): void {
  pendingDraw = false; if (!active || !atlas) return;
  const bounds = detail.getBoundingClientRect(); viewSize = { width: bounds.width, height: bounds.height };
  const dpr = Math.min(2, window.devicePixelRatio || 1); detail.width = Math.round(bounds.width * dpr); detail.height = Math.round(bounds.height * dpr);
  const c = detail.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.imageSmoothingEnabled = false;
  c.fillStyle = '#111b17'; c.fillRect(0, 0, bounds.width, bounds.height); clampCenter();
  const world = active.world, ox = bounds.width / 2 - center.x * zoom, oy = bounds.height / 2 - center.y * zoom;
  const left = Math.max(0, Math.floor(-ox / zoom)), top = Math.max(0, Math.floor(-oy / zoom));
  const right = Math.min(world.width, Math.ceil((bounds.width - ox) / zoom)), bottom = Math.min(world.height, Math.ceil((bounds.height - oy) / zoom));
  const raster = rasterTerrain(world, { x: left, y: top, width: right - left, height: bottom - top }, atlas, desert);
  const low = document.createElement('canvas'); low.width = raster.width; low.height = raster.height;
  const lc = low.getContext('2d')!; const pixels = lc.createImageData(raster.width, raster.height); pixels.data.set(raster.pixels); lc.putImageData(pixels, 0, 0);
  c.drawImage(low, ox + left * zoom, oy + top * zoom, (right - left) * zoom, (bottom - top) * zoom);
  drawWoodland(c, world, ox, oy, zoom, left, top, right, bottom);
  if ($<HTMLInputElement>('#show-grid').checked) {
    c.strokeStyle = '#13201538'; c.lineWidth = 1; c.beginPath();
    for (let x = left; x <= right; x++) { c.moveTo(ox + x * zoom, oy + top * zoom); c.lineTo(ox + x * zoom, oy + bottom * zoom); }
    for (let y = top; y <= bottom; y++) { c.moveTo(ox + left * zoom, oy + y * zoom); c.lineTo(ox + right * zoom, oy + y * zoom); } c.stroke();
  }
  if ($<HTMLInputElement>('#show-routes').checked) drawAnnotations(c, world, ox, oy, zoom, left, top, right, bottom);
}

function scheduleDraw(): void { if (!pendingDraw) { pendingDraw = true; requestAnimationFrame(drawDetail); } }

function thumbnail(canvas: HTMLCanvasElement, scene: Scene): void {
  const world = scene.world, focus = featureCenter(world, scene.id.includes('lake') ? 'lake' : scene.id.includes('mountain') ? 'mountains' : 'hills');
  const width = Math.min(36, world.width), height = Math.min(24, world.height);
  const x = Math.max(0, Math.min(world.width - width, Math.round(focus.x - width / 2))), y = Math.max(0, Math.min(world.height - height, Math.round(focus.y - height / 2)));
  const raster = rasterTerrain(world, { x, y, width, height }, atlas, desert);
  canvas.width = raster.width; canvas.height = raster.height;
  const c = canvas.getContext('2d')!, pixels = c.createImageData(raster.width, raster.height); pixels.data.set(raster.pixels); c.putImageData(pixels, 0, 0);
  drawWoodland(c, world, -x * 16, -y * 16, 16, x, y, x + width, y + height);
  drawAnnotations(c, world, -x * 16, -y * 16, 16, x, y, x + width, y + height);
}

function lakeSample(shape: 'compact', seed: string): World {
  const width = 72, height = 54, random = seededRandom(`${seed}:${shape}:sample`);
  const world: World = { width, height, seed: `${seed}:${shape}`, source: 'freshwater showcase', spawns: [],
    tiles: Array.from({ length: width * height }, (): Tile => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .6, variation: random(), ...terrainYields('grassland', 'none') })) };
  placeFreshwaterLakes(world.tiles, width, height, world.seed, undefined, { count: 1 });
  return world;
}

function addFeature(scene: Scene): void {
  scenes.set(scene.id, scene);
  const button = document.createElement('button'); button.type = 'button'; button.className = 'feature'; button.dataset.scene = scene.id;
  button.setAttribute('aria-pressed', 'false');
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); thumbnail(canvas, scene);
  const copy = document.createElement('span'); copy.className = 'feature-copy';
  const title = document.createElement('strong'); title.textContent = scene.title;
  const note = document.createElement('small'); note.textContent = scene.description;
  copy.append(title, note); button.append(canvas, copy);
  button.onclick = () => { setActive(scene); $('#detail').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('#features').append(button);
}

async function generate(): Promise<void> {
  const token = ++generation, seed = $<HTMLInputElement>('#seed').value.trim() || 'NEW-HORIZONS';
  $<HTMLInputElement>('#seed').value = seed; $('#loading').hidden = false; $('#status').classList.remove('error');
  $<HTMLButtonElement>('#regenerate').disabled = true; $<HTMLButtonElement>('#random-seed').disabled = true;
  const start = performance.now();
  try {
    scenes.clear(); $('#maps').replaceChildren(); $('#features').replaceChildren();
    for (const [index, mode] of modes.entries()) {
      $('#loading-detail').textContent = `${mode.title} · ${index + 1} of 3`; await pauseForPaint();
      const world = generateWorld(seed, undefined, undefined, { style: mode.id });
      const scene = { ...mode, world }, counts = stats(world); scenes.set(mode.id, scene);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'map-card'; button.dataset.scene = mode.id;
      button.setAttribute('aria-label', `Explore ${mode.title}`); button.setAttribute('aria-pressed', 'false');
      button.innerHTML = `<div class="card-top"><strong>${mode.title}</strong><span class="card-index">0${index + 1}</span></div><canvas aria-hidden="true"></canvas><div class="card-bottom"><p>${mode.description}</p><div class="stats"><span><strong>${counts.landPercent}%</strong> land</span><span title="Woodland as a percentage of dry land"><strong>${Math.round(100 * counts.woods / counts.land)}%</strong> wooded land</span><span><strong>${counts.stairs}</strong> ramps</span></div></div>`;
      const canvas = button.querySelector('canvas')!; overview(canvas, scene);
      button.onclick = event => {
        const rect = canvas.getBoundingClientRect();
        const inMap = event.clientY >= rect.top && event.clientY <= rect.bottom;
        setActive(scene, inMap ? { x: (event.clientX - rect.left) / rect.width * world.width, y: (event.clientY - rect.top) / rect.height * world.height } : undefined);
      };
      $('#maps').append(button);
    }
    $('#loading-detail').textContent = 'Drawing terrain samples'; await pauseForPaint();
    for (const [kind, title, description] of [
      ['grass-hills', 'Grassy hill country', 'Tiny 2×2, 2×3, and 2×4 outcrops mixed with varied larger shelves.'],
      ['desert-hills', 'Desert hill country', 'Small sandy outcrops, irregular shelves, and narrow lanes between them.'],
      ['mountain-range', 'Mountain range', 'Long, narrow layered ridges, broken by occasional low-ground passes.'],
    ] as const) {
      const world = buildReliefShowcase(kind, 80, 64, seed);
      if (kind === 'mountain-range') { applyTerrainEcology(world); assignTreeClimate(world); }
      addFeature({ id: kind, title, description, sample: true, world });
    }
    addFeature({ id: 'compact-lake', title: 'Compact lake', description: 'An inland basin with a broad, irregular shoreline.', sample: true, world: lakeSample('compact', seed) });
    if (token !== generation) return;
    setActive(scenes.get('continents')!);
    $('#status').textContent = `Seed ${seed} · ${scenes.get('continents')!.world.width} × ${scenes.get('continents')!.world.height} tiles per world · Generated in ${((performance.now() - start) / 1000).toFixed(1)} seconds · Production terrain generator.`;
    Object.assign(window, { __worldLab: { scenes, stats, hillShapes, setActive, get active() { return active; }, get center() { return center; }, get zoom() { return zoom; } } });
    document.documentElement.dataset.ready = 'true';
  } catch (error) {
    $('#status').textContent = `Generation failed: ${error instanceof Error ? error.message : String(error)}`; $('#status').classList.add('error'); console.error(error);
  } finally {
    $('#loading').hidden = true; $<HTMLButtonElement>('#regenerate').disabled = false; $<HTMLButtonElement>('#random-seed').disabled = false;
  }
}

function zoomTo(value: number): void { zoom = Math.max(10, Math.min(64, value)); scheduleDraw(); }
$('#seed-form').onsubmit = event => { event.preventDefault(); void generate(); };
$('#random-seed').onclick = () => { $<HTMLInputElement>('#seed').value = `ATLAS-${Math.floor(Math.random() * 1e7).toString(36).toUpperCase()}`; void generate(); };
$('#zoom-in').onclick = () => zoomTo(zoom * 1.4); $('#zoom-out').onclick = () => zoomTo(zoom / 1.4);
$('#reset-view').onclick = () => { zoom = 24; setActive(active); };
$('#show-grid').onchange = scheduleDraw; $('#show-routes').onchange = scheduleDraw;
$('#show-vegetation').onchange = () => {
  updateCaption(); scheduleDraw();
  document.querySelectorAll<HTMLCanvasElement>('.map-card canvas').forEach(canvas => overview(canvas, scenes.get((canvas.parentElement as HTMLElement).dataset.scene!)!));
  document.querySelectorAll<HTMLCanvasElement>('.feature canvas').forEach(canvas => thumbnail(canvas, scenes.get((canvas.parentElement as HTMLElement).dataset.scene!)!));
};
document.querySelectorAll<HTMLButtonElement>('[data-jump]').forEach(button => button.onclick = () => { center = featureCenter(active.world, button.dataset.jump!); scheduleDraw(); });
detail.onwheel = event => { event.preventDefault(); zoomTo(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)); };
detail.onpointerdown = event => { if (event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, cx: center.x, cy: center.y }; detail.setPointerCapture(event.pointerId); };
detail.onpointerup = () => { drag = undefined; }; detail.onpointercancel = () => { drag = undefined; };
detail.onpointermove = event => {
  if (!active) return;
  if (drag) { center = { x: drag.cx - (event.clientX - drag.x) / zoom, y: drag.cy - (event.clientY - drag.y) / zoom }; scheduleDraw(); }
  const rect = detail.getBoundingClientRect(), x = Math.floor(center.x + (event.clientX - rect.left - rect.width / 2) / zoom), y = Math.floor(center.y + (event.clientY - rect.top - rect.height / 2) / zoom);
  const world = active.world, tile = x >= 0 && y >= 0 && x < world.width && y < world.height ? world.tiles[y * world.width + x] : undefined;
  if (!tile) return;
  const feature = tile.stair ? `Ramp · uphill ${tile.stair}` : tile.mountainPass ? 'Mountain pass · traversable low ground'
    : ridgeIsLedge(world, x, y) ? 'Cliff · impassable' : tile.ridge ? `Upper ground · level ${ridgeLevel(tile)}` : WATER.has(tile.terrain) ? 'Water · impassable' : 'Low ground · traversable';
  const vegetation = tile.overlay === 'forest' || tile.overlay === 'jungle' ? ` · ${tile.treeClass ?? 'temperate'} woodland` : '';
  const ecology = [tile.biome && BIOME_NAMES[tile.biome], tile.fertility !== undefined && `Soil ${Math.round(tile.fertility * 100)}%`,
    tile.resource && RESOURCE_NAMES[tile.resource]].filter(Boolean).join(' · ');
  $('#tile-info').textContent = `${x}, ${y} · ${tile.terrain}${vegetation}\n${feature}${ecology ? `\n${ecology}` : ''}`;
};
new ResizeObserver(scheduleDraw).observe(detail.parentElement!);
try {
  vegetationAtlas = new Image(); vegetationAtlas.src = assets.vegetation;
  [atlas, desert] = await Promise.all([imagePixels(assets.world), imagePixels(assets.desert)]); await vegetationAtlas.decode(); await generate();
}
catch (error) { $('#loading-detail').textContent = `Unable to load terrain art: ${String(error)}`; console.error(error); }
