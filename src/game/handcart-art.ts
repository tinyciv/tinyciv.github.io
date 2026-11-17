import { runtimeArtUrl } from './runtime-art';
import type { Unit } from './types';
import { recolorCharacterCloth } from './unit-sprites';

export const HANDCART_CELL = 48;
export const HANDCART_FRAMES = 8;
const SCALE = 1.4;
let source: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
const palettes = new Map<string, HTMLCanvasElement>();
const icons = new Map<string, string>();

export function loadHandcartArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/puny-world/characters/Supply-Handcart.png`);
    await image.decode();
    if (image.naturalWidth !== 384 || image.naturalHeight !== 192) throw new Error('Invalid supply handcart sheet');
    source = image;
  })();
}
export function handcartSheet(color: string): HTMLCanvasElement | undefined {
  if (!source) return;
  let canvas = palettes.get(color);
  if (!canvas) {
    canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
    const c = canvas.getContext('2d')!; c.drawImage(source, 0, 0);
    const pixels = c.getImageData(0, 0, canvas.width, canvas.height);
    recolorCharacterCloth(pixels.data, color); c.putImageData(pixels, 0, 0);
    palettes.set(color, canvas);
  }
  return canvas;
}
/** Rows S/E/W/N. World position follows the driver; the cart trails behind. */
export function handcartPose(unit: Pick<Unit, 'facing' | 'moving' | 'id'>, time: number) {
  const dx = Math.cos(unit.facing), dy = Math.sin(unit.facing);
  const row = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 2 : 1 : dy < 0 ? 3 : 0;
  const frame = unit.moving ? Math.floor(time * 8 + unit.id * .37) % HANDCART_FRAMES : 0;
  const anchors = [[24, 40], [32, 31], [16, 31], [24, 26]];
  const [ax, ay] = anchors[row];
  return { row, frame, rect: [frame * 48, row * 48, 48, 48] as [number, number, number, number],
    bounds: { x: 16 - ax * SCALE, y: 27.2 - ay * SCALE, width: 48 * SCALE, height: 48 * SCALE } };
}
export function drawHandcart(c: CanvasRenderingContext2D, unit: Unit, time: number, color: string): void {
  if (unit.inside) return;
  const sheet = handcartSheet(color); if (!sheet) return;
  const { rect, bounds: b } = handcartPose(unit, time);
  c.save(); c.imageSmoothingEnabled = false; c.drawImage(sheet, ...rect, b.x, b.y, b.width, b.height); c.restore();
}
export function handcartIconUrl(color: string): string {
  const cached = icons.get(color); if (cached) return cached;
  const sheet = handcartSheet(color); if (!sheet) return '';
  const c = document.createElement('canvas'); c.width = c.height = 48;
  c.getContext('2d')!.drawImage(sheet, 0, 48, 48, 48, 0, 0, 48, 48);
  const url = c.toDataURL(); icons.set(color, url); return url;
}
