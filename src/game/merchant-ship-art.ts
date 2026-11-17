import { runtimeArtUrl } from './runtime-art';
import type { HarborTradeShip } from './harbor-trade';
import configuration from './merchant-ship.json';

export const MERCHANT_SHIP_BOUNDS = { x: 0, y: -16, width: 32, height: 64 } as const;
export const MERCHANT_SHIP_PIVOT = { x: 16, y: 16 } as const;
let sheet: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

/** Native 16×32 PixelLab frames are shared by every sea-trade voyage. */
export function loadMerchantShipArt(): Promise<void> {
  if (!configuration.approved) return Promise.resolve();
  return loading ??= (async () => {
    const image = new Image();
    image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/naval/merchant-ship-move.png`);
    await image.decode();
    if (image.naturalWidth !== configuration.frameCount * 16 || image.naturalHeight !== 32)
      throw new Error('Invalid merchant ship artwork.');
    sheet = image;
  })();
}

export const merchantShipImage = () => sheet;
export function merchantShipFrame(ship: Pick<HarborTradeShip, 'moving'>, time: number): number {
  return ship.moving ? ((Math.floor(time / configuration.frameSeconds) % configuration.frameCount) + configuration.frameCount) % configuration.frameCount : 0;
}

/** Canvas artwork export shares the same frame and pivot as the GPU renderer. */
export function drawMerchantShip(c: CanvasRenderingContext2D, ship: Pick<HarborTradeShip, 'moving' | 'facing'>,
  x: number, y: number, size: number, time: number): void {
  if (!sheet) return;
  c.save(); c.imageSmoothingEnabled = false;
  c.translate(x + size / 2, y + size / 2); c.rotate(ship.facing + Math.PI / 2);
  c.drawImage(sheet, merchantShipFrame(ship, time) * 16, 0, 16, 32, -size / 2, -size, size, size * 2);
  c.restore();
}
