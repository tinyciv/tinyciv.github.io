import type { Unit } from './types';

export const HORSEMAN_NATIVE_SCALE = 1.5;
export interface HorsemanPose { rect: readonly [number, number, number, number]; anchor: readonly [number, number] }
type ArtKind = 'Horseman' | 'Stable';
const sizes = { Horseman: [128, 384], Stable: [16, 16] } as const;
const originals = new Map<ArtKind, readonly [ImageData, ImageData]>();
const sheets = new Map<string, HTMLCanvasElement>(), icons = new Map<string, string>();
let loading: Promise<void> | undefined;

export function loadCavalryArt(): Promise<void> {
  return loading ??= Promise.all((['Horseman', 'Stable'] as const).map(async kind => {
    const [width, height] = sizes[kind];
    const variants = await Promise.all(['Cyan', 'Red'].map(async color => {
      const image = new Image(); image.src = `${import.meta.env.BASE_URL}assets/miniworld/${kind}-${color}.png`; await image.decode();
      if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error(`Invalid native cavalry asset: ${kind}-${color}`);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const c = canvas.getContext('2d')!; c.drawImage(image, 0, 0); return c.getImageData(0, 0, width, height);
    }));
    originals.set(kind, [variants[0], variants[1]]);
  })).then(() => undefined);
}

/** Horse, steel, weapons, timber and transparency remain exactly native. */
export function recolorCavalryPixels(source: Uint8ClampedArray, red: Uint8ClampedArray, color: string): Uint8ClampedArray {
  const result = new Uint8ClampedArray(source), hex = /^#[\da-f]{6}$/i.test(color) ? color : '#c94c4c';
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  for (let i = 0; i < source.length; i += 4) {
    if (!source[i + 3] || ![0, 1, 2].some(channel => source[i + channel] !== red[i + channel])) continue;
    const shade = Math.max(source[i], source[i + 1], source[i + 2]) / 188;
    for (let channel = 0; channel < 3; channel++) result[i + channel] = Math.min(255, Math.round(rgb[channel] * shade));
  }
  return result;
}

function factionSheet(kind: ArtKind, color: string): HTMLCanvasElement | undefined {
  const source = originals.get(kind); if (!source) return;
  const key = `${kind}:${color}`; let sheet = sheets.get(key);
  if (!sheet) {
    sheet = document.createElement('canvas'); [sheet.width, sheet.height] = sizes[kind];
    const c = sheet.getContext('2d')!, pixels = c.createImageData(sheet.width, sheet.height);
    pixels.data.set(recolorCavalryPixels(source[0].data, source[1].data, color)); c.putImageData(pixels, 0, 0); sheets.set(key, sheet);
  }
  return sheet;
}
export const horsemanSheet = (color: string): HTMLCanvasElement | undefined => factionSheet('Horseman', color);
export const stableSheet = (color: string): HTMLCanvasElement | undefined => factionSheet('Stable', color);

/** The native knight provides four directions, each with idle/walk/attack. */
export function horsemanPose(unit: Pick<Unit, 'id' | 'facing' | 'moving' | 'attackTime'>, time: number): HorsemanPose {
  const dx = Math.cos(unit.facing), dy = Math.sin(unit.facing);
  const direction = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 2 : 1 : dy < 0 ? 3 : 0;
  const action = unit.attackTime > 0 ? 2 : unit.moving ? 1 : 0;
  const frame = action === 2 ? Math.min(3, Math.floor((.28 - Math.min(.28, unit.attackTime)) / .28 * 4))
    : Math.floor(time * (unit.moving ? 9 : 3) + unit.id * .37) % 4;
  return { rect: [frame * 32, (direction * 3 + action) * 32, 32, 32], anchor: [16, 25] };
}
export function horsemanBounds(pose: HorsemanPose): { x: number; y: number; width: number; height: number } {
  return { x: 16 - pose.anchor[0] * HORSEMAN_NATIVE_SCALE, y: 27.2 - pose.anchor[1] * HORSEMAN_NATIVE_SCALE,
    width: pose.rect[2] * HORSEMAN_NATIVE_SCALE, height: pose.rect[3] * HORSEMAN_NATIVE_SCALE };
}
export function drawHorseman(c: CanvasRenderingContext2D, unit: Unit, time: number, color: string): void {
  const sheet = horsemanSheet(color); if (!sheet || unit.inside) return;
  const pose = horsemanPose(unit, time), bounds = horsemanBounds(pose);
  c.save(); c.imageSmoothingEnabled = false; c.drawImage(sheet, ...pose.rect, bounds.x, bounds.y, bounds.width, bounds.height); c.restore();
}
export function drawStable(c: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const sheet = stableSheet(color); if (!sheet) return;
  c.save(); c.imageSmoothingEnabled = false; c.drawImage(sheet, 0, 0, 16, 16, x, y, size, size); c.restore();
}
export function horsemanIconUrl(color = '#c94c4c'): string {
  const key = `horseman:${color}`, cached = icons.get(key); if (cached) return cached;
  const sheet = horsemanSheet(color); if (!sheet) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  canvas.getContext('2d')!.drawImage(sheet, 0, 0, 32, 32, 0, 0, 32, 32);
  const icon = canvas.toDataURL(); icons.set(key, icon); return icon;
}
export function stableIconUrl(color = '#c94c4c'): string {
  const key = `stable:${color}`, cached = icons.get(key); if (cached) return cached;
  const sheet = stableSheet(color); if (!sheet) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  drawStable(canvas.getContext('2d')!, 0, 0, 32, color);
  const icon = canvas.toDataURL(); icons.set(key, icon); return icon;
}
