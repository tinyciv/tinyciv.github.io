import { runtimeArtUrl } from './runtime-art';
import { silhouetteOutline } from './silhouette-outline';
import type { Unit } from './types';

const livestockSheets = ['cow', 'sheep', 'horse'] as const;
type WildlifeKind = 'boar' | 'marshBird' | 'buck' | 'doe' | typeof livestockSheets[number];
type WildlifeSheet = HTMLImageElement | HTMLCanvasElement;
export const isLargeLivestock = (kind: Unit['kind']): boolean => kind === 'cow' || kind === 'sheep';
const wildlifeTileBounds = { x: 0, y: 0, width: 32, height: 32 };
// Center the wider cells and register their hooves near the original ground line.
const largeLivestockBounds = { x: -8, y: -16, width: 48, height: 48 };

/** Wildlife rows are S/N/E/W. The MiniWorld bird rows are S/N/W/E. */
const sheets: Partial<Record<WildlifeKind, WildlifeSheet>> = {};
const portraits: Partial<Record<WildlifeKind, string>> = {};
let loading: Promise<void> | undefined;
let loadingDeer: Promise<void> | undefined;
let loadingLivestock: Promise<void> | undefined;

async function loadSheet(path: string, width: number, height: number): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/${path}.png`);
  await image.decode();
  if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error(`Invalid wildlife sheet ${path}.`);
  return image;
}

export function loadDeerArt(): Promise<void> {
  return loadingDeer ??= (async () => {
    const [buck, doe] = await Promise.all([
      loadSheet('wildlife/deer/buck', 272, 64), loadSheet('wildlife/deer/doe', 272, 64),
    ]);
    sheets.buck = buck;
    sheets.doe = doe;
  })();
}

export function loadLivestockArt(): Promise<void> {
  return loadingLivestock ??= Promise.all(livestockSheets.map(async kind => {
    const larger = isLargeLivestock(kind);
    const size = larger ? 24 : 16;
    const columns = larger ? 5 : 4;
    sheets[kind] = await loadSheet(`wildlife/livestock/${kind}`, size * columns, size * 4);
  })).then(() => undefined);
}

/** Only the two red comb/wattle colors change. Feather, beak, outline and
 * transparent pixels stay byte-for-byte identical to Shade's chicken. */
export const MARSH_BIRD_PALETTE = [
  { from: [188, 78, 78], to: [137, 154, 100] },
  { from: [164, 52, 52], to: [89, 107, 67] },
] as const;
export function recolorMarshBird(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const color = MARSH_BIRD_PALETTE.find(({ from }) => data[i] === from[0] && data[i + 1] === from[1] && data[i + 2] === from[2]);
    if (color) { data[i] = color.to[0]; data[i + 1] = color.to[1]; data[i + 2] = color.to[2]; }
  }
}

export const wildlifeImage = (kind: WildlifeKind = 'boar'): WildlifeSheet | undefined => sheets[kind];
export function loadWildlifeArt(): Promise<void> {
  return loading ??= (async () => {
    const [boar, chicken] = await Promise.all([loadSheet('miniworld/Boar', 64, 128),
      loadSheet('miniworld/Chicken', 64, 64), loadDeerArt(), loadLivestockArt()]);
    const bird = document.createElement('canvas'); bird.width = bird.height = 64;
    const context = bird.getContext('2d')!;
    context.drawImage(chicken, 0, 0);
    const pixels = context.getImageData(0, 0, 64, 64);
    recolorMarshBird(pixels.data); context.putImageData(pixels, 0, 0);
    sheets.boar = boar; sheets.marshBird = bird;
  })();
}

export function wildlifeKind(unit: Pick<Unit, 'kind' | 'deerSex'>): WildlifeKind | undefined {
  if (unit.kind === 'deer') return unit.deerSex === 'male' ? 'buck' : 'doe';
  if (unit.kind === 'boar' || unit.kind === 'marshBird' || unit.kind === 'cow' || unit.kind === 'sheep' || unit.kind === 'horse')
    return unit.kind;
}

export function wildlifeFrame(unit: Unit, time: number): { row: number; frame: number } {
  const east = Math.cos(unit.facing), south = Math.sin(unit.facing);
  const eastRow = unit.kind === 'marshBird' ? 3 : 2, westRow = unit.kind === 'marshBird' ? 2 : 3;
  const row = Math.abs(east) > Math.abs(south) ? east >= 0 ? eastRow : westRow : south >= 0 ? 0 : 1;
  if (unit.kind === 'deer' && unit.moving) {
    const frame = unit.deerFleeing ? 9 + Math.floor(time * 15 + unit.id * .37) % 8
      : 1 + Math.floor(time * 9 + unit.id * .37) % 8;
    return { row, frame };
  }
  const larger = isLargeLivestock(unit.kind);
  const pace = larger || unit.kind === 'horse' ? 5 : 9;
  const frame = unit.moving ? (larger ? 1 : 0) + Math.floor(time * pace + unit.id * .37) % 4 : 0;
  return { row, frame };
}

export function wildlifePose(unit: Unit, time: number) {
  const { row, frame } = wildlifeFrame(unit, time);
  const larger = isLargeLivestock(unit.kind);
  const size = larger ? 24 : 16;
  const rect: [number, number, number, number] = [frame * size, row * size, size, size];
  return { rect, bounds: larger ? largeLivestockBounds : wildlifeTileBounds };
}

export function drawWildlife(c: CanvasRenderingContext2D, unit: Unit, time: number): void {
  const kind = wildlifeKind(unit), sheet = kind && wildlifeImage(kind);
  if (!sheet) return;
  const { rect, bounds: { x, y, width, height } } = wildlifePose(unit, time);
  c.imageSmoothingEnabled = false;
  c.drawImage(sheet, ...rect, x, y, width, height);
}

export function livestockOutlineBounds(unit: Unit) {
  const { x, y, width, height } = isLargeLivestock(unit.kind) ? largeLivestockBounds : wildlifeTileBounds;
  const pad = 6;
  return { x: x - pad, y: y - pad, width: width + pad * 2, height: height + pad * 2 };
}

export function drawLivestockOutline(c: CanvasRenderingContext2D, unit: Unit, time: number): void {
  const { x, y, width, height } = livestockOutlineBounds(unit);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const mask = canvas.getContext('2d')!;
  mask.translate(-x, -y);
  drawWildlife(mask, unit, time);
  c.drawImage(silhouetteOutline(canvas, '#ed574c'), x, y);
}
function wildlifeIconUrl(kind: WildlifeKind): string {
  const sheet = wildlifeImage(kind);
  if (!sheet) return '';
  if (!portraits[kind]) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
    canvas.getContext('2d')!.drawImage(sheet, 0, 32, 16, 16, 0, 0, 16, 16);
    portraits[kind] = canvas.toDataURL();
  }
  return portraits[kind]!;
}
export const boarIconUrl = (): string => wildlifeIconUrl('boar');
export const birdIconUrl = (): string => wildlifeIconUrl('marshBird');
