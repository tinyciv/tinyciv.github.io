import { runtimeArtUrl } from './runtime-art';
let academy: HTMLImageElement | undefined;
let groundOffset = 0;
let loading: Promise<void> | undefined;

/** PixelLab native 32px artwork covers the academy's two-by-two footprint. */
export function loadMilitaryAcademyArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/buildings/military-academy.png`);
    await image.decode();
    if (image.naturalWidth !== 32 || image.naturalHeight !== 32) throw new Error('Invalid Military Academy artwork');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    let bottom = 32;
    while (bottom > 0 && !Array.from({ length: 32 }, (_, x) => pixels[((bottom - 1) * 32 + x) * 4 + 3]).some(Boolean)) bottom--;
    groundOffset = (32 - bottom) * 2;
    academy = image;
  })();
}

export function drawMilitaryAcademy(c: CanvasRenderingContext2D): void {
  if (!academy) return;
  c.imageSmoothingEnabled = false;
  c.drawImage(academy, 0, groundOffset, 64, 64);
}
