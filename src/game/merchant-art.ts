import type { Unit } from './types';

/** Approved 1B cloth-hat merchant on the unchanged Miniworld horse.
 * Each direction has adjacent idle/walk rows of four native 32px frames. */
let rider: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
let portrait: string | undefined;
export const merchantImage = (): HTMLImageElement | undefined => rider;
export function loadMerchantArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}assets/miniworld/Merchant-Rider.png`;
    await image.decode();
    if (image.naturalWidth !== 128 || image.naturalHeight !== 256) throw new Error('Invalid merchant rider sheet.');
    rider = image;
  })();
}

export function merchantFrame(unit: Pick<Unit, 'id' | 'facing' | 'moving'>, time: number): { row: number; column: number } {
  const dx = Math.cos(unit.facing), dy = Math.sin(unit.facing);
  const direction = Math.abs(dx) > Math.abs(dy) ? dx >= 0 ? 1 : 2 : dy >= 0 ? 0 : 3;
  const framesPerSecond = unit.moving ? 7 : 1 / .3;
  return { row: direction * 2 + Number(unit.moving), column: Math.floor(time * framesPerSecond + unit.id * .13) % 4 };
}

/** Called inside sprites.ts's local 32px unit coordinate system. Feet align
 * with other people; the horse's longer silhouette remains within one cell. */
export function drawMerchant(c: CanvasRenderingContext2D, unit: Unit, time: number): void {
  if (!rider || unit.inside) return;
  const { row, column } = merchantFrame(unit, time);
  c.imageSmoothingEnabled = false;
  c.drawImage(rider, column * 32, row * 32, 32, 32, -8, -8, 48, 48);
}

export function merchantIconUrl(): string {
  if (portrait) return portrait;
  if (!rider) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  canvas.getContext('2d')!.drawImage(rider, 0, 0, 32, 32, 0, 0, 32, 32);
  return portrait = canvas.toDataURL();
}
