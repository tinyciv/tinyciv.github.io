import { runtimeArtUrl } from './runtime-art';
/** Approved Batch 2 civic art (9D Colosseum, 5C barracks), authored on a native
 * 32px grid and drawn at 2× with nearest-neighbor sampling. The barracks covers
 * a 2×1 footprint and rises one tile above it (see buildingArtTop). */
const images = new Map<'colosseum' | 'barracks' | 'forum' | 'granary' | 'thermalBath', HTMLImageElement>();
let loading: Promise<void> | undefined;
let colosseumIcon = '';
let thermalBathAnimation: HTMLImageElement | undefined;
export const THERMAL_BATH_FRAME_COUNT = 9;
export const THERMAL_BATH_FRAME_SECONDS = .18;
export const thermalBathFrame = (time: number): number => Math.floor(time / THERMAL_BATH_FRAME_SECONDS) % THERMAL_BATH_FRAME_COUNT;

export function loadCivicArt(): Promise<void> {
  return loading ??= Promise.all((['colosseum', 'barracks', 'forum', 'granary', 'thermalBath'] as const).map(async kind => {
    const image = new Image();
    image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/buildings/${kind === 'thermalBath' ? 'thermal-bath' : kind}.png`);
    await image.decode();
    if (image.naturalWidth !== 32 || image.naturalHeight !== 32) throw new Error(`Invalid ${kind} artwork.`);
    images.set(kind, image);
    if (kind === 'thermalBath') {
      const animation = new Image();
      animation.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/buildings/thermal-bath-animation.png`);
      await animation.decode();
      if (animation.naturalWidth !== THERMAL_BATH_FRAME_COUNT * 32 || animation.naturalHeight !== 32)
        throw new Error('Invalid thermal bath animation artwork.');
      thermalBathAnimation = animation;
    }
  })).then(() => undefined);
}

function draw(c: CanvasRenderingContext2D, kind: 'colosseum' | 'barracks' | 'forum' | 'granary' | 'thermalBath', x: number, y: number, width: number, height: number): void {
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
