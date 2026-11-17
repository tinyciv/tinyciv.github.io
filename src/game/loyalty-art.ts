import { runtimeArtUrl } from './runtime-art';
let wreath: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

/** Native PixelLab olive wreath, loaded before city labels are cached. */
export function loadLoyaltyArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/ui/loyalty-olive-wreath.png`);
    await image.decode();
    if (image.naturalWidth !== 20 || image.naturalHeight !== 20) throw new Error('Invalid loyalty wreath artwork');
    wreath = image;
  })();
}
export function drawLoyaltyWreath(c: CanvasRenderingContext2D, x: number, y: number): void {
  if (!wreath) return;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(wreath, Math.round(x), Math.round(y), 20, 20);
  c.restore();
}
