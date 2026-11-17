import palettes from './relief-palettes.json';
import shapeBounds from './relief-shapes.json';
import { tileAt, type Tile, type World } from './types';
import { worldRevisions } from './world-revisions';
import { createReliefLayoutCatalog, createReliefLayoutPlan, RELIEF_CHUNK_SIZE,
  type ReliefLayoutPlan, type ReliefLayoutSource, type ReliefSizeBand, type ReliefStamp } from './relief-layout';

export type { ReliefStamp } from './relief-layout';

type Palette = keyof typeof palettes;
type Cell = { x: number; y: number; width: number; height: number; nativeWidth?: number;
  rowSpans?: (number[] | null)[]; opaqueRows?: number[][][] };
const CHUNK = RELIEF_CHUNK_SIZE, MAX_SIZE = 5;
/** The smallest reference foothill spans one and a half 16-pixel tiles. */
export const MIN_RELIEF_WIDTH = 1.5;
const nativeSizes = [32, 48, 64];
const sheetFiles = ['atlas-A.png', 'atlas-B.png', 'atlas-C.png', 'hills-reference.png', 'rocky-hills-reference.png',
  'hills-varied.png', 'rocky-hills-varied.png', 'mountains-varied.png'];
const nativeWidth = (style: number, cell: Cell): number => cell.nativeWidth ?? nativeSizes[style];
const sheets: HTMLImageElement[] = [], cells: Cell[][] = shapeBounds;
// The offline build uses the same crop, nearest sampling and alpha cutoff.
// Preserve source cells for layout; runtime sheets contain native-size rasters.
const rasterCells = cells.map((family, style) => {
  let top = 0;
  return family.map(cell => {
    const width = nativeWidth(style, cell), height = Math.max(2, Math.round(width * cell.height / cell.width));
    const frame = { x: 0, y: top, width, height }; top += height; return frame;
  });
});
const rasters = new Map<string, HTMLCanvasElement>();
let loading: Promise<void> | undefined;

function layoutSources(styles: readonly number[]): ReliefLayoutSource[] {
  return styles.flatMap(style => (cells[style] ?? []).flatMap((cell, slot) => {
    if (style < 3 && slot < 12) return [];
    const width = nativeWidth(style, cell);
    return [{ style, slot, width, height: Math.max(2, Math.round(width * cell.height / cell.width)),
      rowSpans: cell.rowSpans, opaqueRows: cell.opaqueRows,
      band: (style < 3 ? style : Math.floor(slot / 4)) as ReliefSizeBand }];
  }));
}

/** The same immutable native-size catalog is available to standalone reviews. */
export const reliefArtLayoutCatalog = createReliefLayoutCatalog({
  hills: layoutSources([3, 5]), rockyHills: layoutSources([4, 6]),
  mountains: layoutSources([0, 1, 2, 7]),
});
const activeStyles = new Set<number>();
for (const family of Object.values(reliefArtLayoutCatalog))
  for (const band of family) for (const source of band) activeStyles.add(source.style);

/** Imagegen silhouettes; only crop, native rasterization and palette mapping. */
export function loadReliefArt(): Promise<void> {
  return loading ??= Promise.all([...activeStyles].map(async style => {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject;
      image.src = `${import.meta.env.BASE_URL}assets/runtime/relief/${sheetFiles[style].replace('.png', '.webp')}`;
    });
    sheets[style] = image;
  })).then(() => undefined);
}

const levels = { surface: [46, 72, 97, 123, 151, 185], rock: [43, 75, 109, 144, 180, 220] };
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const ramps = Object.fromEntries(Object.entries(palettes).filter(([, p]) => 'surface' in p).map(([key, p]) => {
  const ramp = p as typeof palettes.plains; return [key, { surface: ramp.surface.map(rgb), rock: ramp.rock.map(rgb) }];
}));
export function reliefImage(style: number, slot: number, palette: Palette): HTMLCanvasElement | undefined {
  if (!cells[style]?.[slot]) return;
  const key = `${style}:${slot}:${palette}`, cached = rasters.get(key); if (cached) return cached;
  const cell = cells[style][slot], canvas = document.createElement('canvas');
  canvas.width = nativeWidth(style, cell); canvas.height = Math.max(2, Math.round(canvas.width * cell.height / cell.width));
  const c = canvas.getContext('2d', { willReadFrequently: true })!; c.imageSmoothingEnabled = false;
  const frame = rasterCells[style][slot];
  c.drawImage(sheets[style], frame.x, frame.y, frame.width, frame.height, 0, 0, canvas.width, canvas.height);
  const pixels = c.getImageData(0, 0, canvas.width, canvas.height), data = pixels.data;
  const lookup = new Map<number, number[]>();
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = data[i + 3] >= 192 ? 255 : 0;
    if (!data[i + 3] || palette === 'grassland') continue;
    const r = data[i], g = data[i + 1], b = data[i + 2], code = r * 65536 + g * 256 + b;
    let color = lookup.get(code);
    if (!color) {
      const material = g > r + 4 && g > b * 1.16 ? 'surface' : 'rock';
      const light = r * .2126 + g * .7152 + b * .0722, shades = levels[material]; let index = 0;
      for (let n = 1; n < shades.length; n++) if (Math.abs(light - shades[n]) < Math.abs(light - shades[index])) index = n;
      color = ramps[palette][material][index]; lookup.set(code, color);
    }
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2];
  }
  c.putImageData(pixels, 0, 0); rasters.set(key, canvas); return canvas;
}

interface ArtPlan { revision: number; tiles: Tile[]; width: number; height: number; seed: string; layout: ReliefLayoutPlan }
const plans = new WeakMap<World, ArtPlan>();
/** Generation may change palettes/exclusions before publishing a geometry revision. */
export function resetReliefArtPlan(world: World): void { plans.delete(world); }
function planFor(world: World): ArtPlan {
  const revision = worldRevisions(world).geometry, old = plans.get(world);
  if (old && old.revision === revision && old.tiles === world.tiles && old.seed === world.seed && old.width === world.width && old.height === world.height) return old;
  const plan = { revision, tiles: world.tiles, width: world.width, height: world.height, seed: world.seed,
    layout: createReliefLayoutPlan(world, reliefArtLayoutCatalog) };
  plans.set(world, plan); return plan;
}

function chunk(world: World, plan: ArtPlan, cx: number, cy: number): readonly ReliefStamp[] {
  return plan.layout.chunks.get(cy * Math.ceil(world.width / CHUNK) + cx) ?? [];
}

/** Bounded viewport lookup; geometry is composed once per visible chunk/revision. */
export function visibleReliefStamps(world: World, left: number, top: number, right: number, bottom: number): ReliefStamp[] {
  const plan = planFor(world), result: ReliefStamp[] = [];
  const x0 = Math.max(0, Math.floor((left - MAX_SIZE) / CHUNK)), y0 = Math.max(0, Math.floor(top / CHUNK));
  const x1 = Math.min(Math.ceil(world.width / CHUNK) - 1, Math.floor((right + MAX_SIZE) / CHUNK));
  const y1 = Math.min(Math.ceil(world.height / CHUNK) - 1, Math.floor((bottom + MAX_SIZE) / CHUNK));
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (const stamp of chunk(world, plan, cx, cy))
    if (stamp.x < right && stamp.x + stamp.width > left && stamp.y < bottom && stamp.y + stamp.height > top) result.push(stamp);
  return result;
}

export function drawReliefStamp(c: CanvasRenderingContext2D, stamp: ReliefStamp, tileSize = 16): void {
  const image = reliefImage(stamp.style, stamp.slot, stamp.palette); if (!image) return;
  c.imageSmoothingEnabled = false; c.drawImage(image, stamp.x * tileSize, stamp.y * tileSize, stamp.width * tileSize, stamp.height * tileSize);
}

/** Figures standing on a slope draw after that slope's own ground silhouette. */
export function reliefFigureDepth(world: World, x: number, y: number, depth: number): number {
  return tileAt(world, Math.floor(x), Math.floor(y))?.relief === 'hills' ? Math.max(depth, Math.floor(y) + 15 / 16) : depth;
}
