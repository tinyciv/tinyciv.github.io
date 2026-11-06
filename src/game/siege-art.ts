import type { Building, Unit } from './types';

/** Unmodified Miniworld sprites. Native thrusts occupy two cells so their
 * extended spear is never clipped into the single-cell walking rectangle. */
export type SiegeRect = readonly [number, number, number, number];
export interface SpearmanPose { rect: SiegeRect; anchor: readonly [number, number] }
const SOUTH_THRUST = [[0, 64, 16, 32], [0, 96, 16, 32], [0, 128, 16, 32]] as const;
const NORTH_THRUST = [[16, 64, 16, 32], [16, 96, 16, 32], [16, 128, 16, 32]] as const;
const WEST_THRUST = [[32, 64, 32, 16], [32, 80, 32, 16], [32, 96, 32, 16]] as const;
const EAST_THRUST = [[32, 112, 32, 16], [32, 128, 32, 16], [32, 144, 32, 16]] as const;
export const SPEARMAN_NATIVE_SCALE = 1.8;
let ballista: HTMLImageElement | undefined, bolt: HTMLImageElement | undefined;
let originals: ImageData[] | undefined;
let loading: Promise<void> | undefined;
const sheets = new Map<string, HTMLCanvasElement>(), icons = new Map<string, string>();
const url = (name: string) => `${import.meta.env.BASE_URL}assets/miniworld/${name}.png`;

export function loadSiegeArt(): Promise<void> {
  return loading ??= (async () => {
    const images = await Promise.all([
      ['Ballista', 112, 64], ['BallistaBolt', 32, 16], ['Spearman-Cyan', 80, 224], ['Spearman-Red', 80, 224],
    ].map(async ([name, width, height]) => {
      const image = new Image(); image.src = url(String(name)); await image.decode();
      if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error(`Invalid native siege sheet: ${name}`);
      return image;
    }));
    [ballista, bolt] = images;
    originals = images.slice(2).map(image => {
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 224;
      const c = canvas.getContext('2d')!; c.drawImage(image, 0, 0);
      return c.getImageData(0, 0, 80, 224);
    });
  })();
}

/** Only native faction cloth differs between the two source versions. */
export function recolorSpearmanPixels(source: Uint8ClampedArray, red: Uint8ClampedArray, color: string): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(source);
  const hex = /^#[\da-f]{6}$/i.test(color) ? color : '#c94c4c';
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3] || ![0, 1, 2].some(channel => source[i + channel] !== red[i + channel])) continue;
    const shade = Math.max(source[i], source[i + 1], source[i + 2]) / 188;
    for (let channel = 0; channel < 3; channel++) pixels[i + channel] = Math.min(255, Math.round(rgb[channel] * shade));
  }
  return pixels;
}

export function spearmanSheet(color: string): HTMLCanvasElement | undefined {
  if (!originals) return;
  let sheet = sheets.get(color);
  if (!sheet) {
    sheet = document.createElement('canvas'); sheet.width = 80; sheet.height = 224;
    const c = sheet.getContext('2d')!, pixels = c.createImageData(80, 224);
    pixels.data.set(recolorSpearmanPixels(originals[0].data, originals[1].data, color));
    c.putImageData(pixels, 0, 0); sheets.set(color, sheet);
  }
  return sheet;
}

/** Four authored directions; diagonal movement chooses its dominant axis. */
export function spearmanPose(unit: Pick<Unit, 'id' | 'facing' | 'moving' | 'attackTime'>, time: number): SpearmanPose {
  const dx = Math.cos(unit.facing), dy = Math.sin(unit.facing);
  const row = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 2 : 3 : dy < 0 ? 1 : 0;
  if (unit.attackTime > 0) {
    const phase = Math.min(2, Math.floor((.28 - Math.min(.28, unit.attackTime)) / .28 * 3));
    const poses = [SOUTH_THRUST, NORTH_THRUST, WEST_THRUST, EAST_THRUST][row];
    return { rect: poses[phase], anchor: row === 1 ? [8, 31] : row === 2 ? [24, 15] : [8, 15] };
  }
  const frame = unit.moving ? 1 + Math.floor(time * 9 + unit.id * .37) % 4 : 0;
  return { rect: [frame * 16, row * 16, 16, 16], anchor: [8, 15] };
}

/** Same foot anchor as Puny people; native figure heights are about 25px. */
export function spearmanBounds(pose: SpearmanPose): { x: number; y: number; width: number; height: number } {
  return { x: 16 - pose.anchor[0] * SPEARMAN_NATIVE_SCALE, y: 27.2 - pose.anchor[1] * SPEARMAN_NATIVE_SCALE,
    width: pose.rect[2] * SPEARMAN_NATIVE_SCALE, height: pose.rect[3] * SPEARMAN_NATIVE_SCALE };
}

export function drawSpearman(c: CanvasRenderingContext2D, unit: Unit, time: number, color: string): void {
  const sheet = spearmanSheet(color); if (!sheet || unit.inside) return;
  const pose = spearmanPose(unit, time), bounds = spearmanBounds(pose);
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(sheet, ...pose.rect, bounds.x, bounds.y, bounds.width, bounds.height); c.restore();
}

export function ballistaFrame(building: Pick<Building, 'siegeFacing' | 'siegeShotAt'>, time: number): { row: number; column: number } {
  const angle = building.siegeFacing ?? -Math.PI / 2, dx = Math.cos(angle), dy = Math.sin(angle);
  // Unlike the spearman sheet, the native ballista rows are N, S, E, W.
  // The visible bolt tip points right in row 2 and left in row 3.
  const row = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 3 : 2 : dy < 0 ? 0 : 1;
  const age = building.siegeShotAt === undefined ? Infinity : time - building.siegeShotAt;
  const column = age >= 0 && age < .8 ? Math.min(6, 3 + Math.floor(age / .2)) : 0;
  return { row, column };
}

export function drawBallista(c: CanvasRenderingContext2D, building: Pick<Building, 'siegeFacing' | 'siegeShotAt'>,
  x: number, y: number, size: number, time: number): void {
  if (!ballista) return;
  const { row, column } = ballistaFrame(building, time);
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(ballista, column * 16, row * 16, 16, 16, x, y, size, size); c.restore();
}

/** The source's second cell points east, matching the renderer's flight axis. */
export function drawBallistaBolt(c: CanvasRenderingContext2D, size: number): void {
  if (!bolt) return;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(bolt, 16, 0, 16, 16, -size * .45, -size * .45, size * .9, size * .9); c.restore();
}

export function ballistaIconUrl(): string {
  const cached = icons.get('ballista'); if (cached) return cached;
  if (!ballista) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  drawBallista(canvas.getContext('2d')!, {}, 0, 0, 32, 0);
  const icon = canvas.toDataURL(); icons.set('ballista', icon); return icon;
}

export function spearmanIconUrl(color = '#f34f59'): string {
  const key = `spearman:${color}`, cached = icons.get(key); if (cached) return cached;
  const sheet = spearmanSheet(color); if (!sheet) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false; c.drawImage(sheet, 0, 0, 16, 16, 0, 0, 32, 32);
  const icon = canvas.toDataURL(); icons.set(key, icon); return icon;
}
