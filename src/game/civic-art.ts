import { runtimeArtUrl } from './runtime-art';
import { TILE_SIZE } from './types';
/** Approved Batch 2 civic art (9D Colosseum, 5C barracks), authored on a native
 * 32px grid and drawn at 2× with nearest-neighbor sampling. The barracks covers
 * a 2×1 footprint and rises one tile above it (see buildingArtTop). */
const civicKinds = ['colosseum', 'barracks', 'forum', 'granary', 'thermalBath', 'marketplace'] as const;
type CivicKind = typeof civicKinds[number];
const images = new Map<CivicKind, HTMLImageElement>();
let loading: Promise<void> | undefined;
let colosseumIcon = '';
let thermalBathAnimation: HTMLImageElement | undefined;
let fountainAnimation: HTMLImageElement | undefined;
export const FOUNTAIN_FRAME_SIZE = 24;
const FOUNTAIN_FRAME_COUNT = 9;
const FOUNTAIN_DRAW_SIZE = 27;
const FOUNTAIN_SCALE = FOUNTAIN_DRAW_SIZE / FOUNTAIN_FRAME_SIZE;
// Anchor on the fixed stone basin so the moving spray does not shift the building.
export const FOUNTAIN_ART_BOUNDS = {
  x: TILE_SIZE / 2 - 12.5 * FOUNTAIN_SCALE,
  y: TILE_SIZE / 2 - 14 * FOUNTAIN_SCALE,
  width: FOUNTAIN_DRAW_SIZE,
  height: FOUNTAIN_DRAW_SIZE,
};
export const fountainSheet = (): HTMLImageElement | undefined => fountainAnimation;
export const fountainFrame = (time: number): number => Math.floor(time / .18) % FOUNTAIN_FRAME_COUNT;
export const THERMAL_BATH_FRAME_COUNT = 9;
export const THERMAL_BATH_FRAME_SECONDS = .18;
export const thermalBathFrame = (time: number): number => Math.floor(time / THERMAL_BATH_FRAME_SECONDS) % THERMAL_BATH_FRAME_COUNT;

async function loadCivicSprite(path: string, width = 32, height = 32): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}${path}`);
  await image.decode();
  if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error(`Invalid civic artwork ${path}`);
  return image;
}

export function loadCivicArt(): Promise<void> {
  return loading ??= Promise.all([
    ...civicKinds.map(async kind => {
      const path = `assets/buildings/${kind === 'thermalBath' ? 'thermal-bath' : kind}.png`;
      images.set(kind, await loadCivicSprite(path));
    }),
    loadCivicSprite('assets/buildings/thermal-bath-animation.png', THERMAL_BATH_FRAME_COUNT * 32)
      .then(image => { thermalBathAnimation = image; }),
    loadCivicSprite('assets/buildings/fountain-animation.png', FOUNTAIN_FRAME_COUNT * FOUNTAIN_FRAME_SIZE, FOUNTAIN_FRAME_SIZE)
      .then(image => { fountainAnimation = image; }),
  ]).then(() => undefined);
}

function draw(c: CanvasRenderingContext2D, kind: CivicKind, x: number, y: number, width: number, height: number): void {
  const image = images.get(kind); if (!image) return;
  c.save(); c.imageSmoothingEnabled = false; c.drawImage(image, x, y, width, height); c.restore();
}
/** Two tiles square, exactly over the 2×2 footprint. */
export function drawColosseum(c: CanvasRenderingContext2D, x: number, y: number, size: number): void { draw(c, 'colosseum', x, y, size * 2, size * 2); }
/** Two tiles wide and two tall: the hall fills the footprint, the tower rises above it. */
export function drawBarracks(c: CanvasRenderingContext2D, x: number, y: number, size: number): void { draw(c, 'barracks', x, y - size, size * 2, size * 2); }

export function colosseumIconUrl(): string {
  if (colosseumIcon) return colosseumIcon;
  const image = images.get('colosseum'); if (!image) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false; c.drawImage(image, 0, 0, 64, 64);
  return colosseumIcon = canvas.toDataURL();
}

/** Existing open marble colonnade, unchanged on its native 32px grid.
 * Its ground anchor (16,31) meets the footprint baseline; row 31 is padding. */
export function drawForum(c: CanvasRenderingContext2D, x: number, y: number, size: number): void { draw(c, 'forum', x, y + size / 16, size * 2, size * 2); }

/** Fountain Agora, anchored at the bottom of its 2×2 footprint. */
export function drawMarketplace(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  draw(c, 'marketplace', x, y + size / 16, size * 2, size * 2);
}

export function drawFountain(c: CanvasRenderingContext2D, time: number): void {
  if (!fountainAnimation) return;
  const { x, y, width, height } = FOUNTAIN_ART_BOUNDS;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(fountainAnimation, fountainFrame(time) * FOUNTAIN_FRAME_SIZE, 0, FOUNTAIN_FRAME_SIZE, FOUNTAIN_FRAME_SIZE, x, y, width, height);
  c.restore();
}

/** Original wooden granary, ground anchor (16,31); its last row is padding. */
export function drawGranary(c: CanvasRenderingContext2D, x: number, y: number, size: number): void { draw(c, 'granary', x, y + size / 16, size * 2, size * 2); }

/** Selected native 1C building: only the generated water and steam animate.
 * The source foundation reaches row 31, one pixel above the canvas baseline. */
export function drawThermalBath(c: CanvasRenderingContext2D, x: number, y: number, size: number, time = 0): void {
  if (!thermalBathAnimation) { draw(c, 'thermalBath', x, y + size / 16, size * 2, size * 2); return; }
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(thermalBathAnimation, thermalBathFrame(time) * 32, 0, 32, 32, x, y + size / 16, size * 2, size * 2);
  c.restore();
}
