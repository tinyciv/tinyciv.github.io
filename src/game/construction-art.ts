import { runtimeArtUrl } from './runtime-art';
export interface ConstructionFootprint { x: number; y: number; width: number; height: number }

const images = new Map<1 | 2, HTMLImageElement>();
let loading: Promise<void> | undefined;

export function loadConstructionArt(): Promise<void> {
  return loading ??= Promise.all(([1, 2] as const).map(async size => {
    const image = new Image();
    image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/construction/${size}x${size}.png`);
    await image.decode();
    if (image.naturalWidth !== size * 16 || image.naturalHeight !== size * 16)
      throw new Error(`Invalid construction artwork: ${size}x${size}`);
    images.set(size, image);
  })).then(() => undefined);
}

/** Keep approved art at native pixel density, centered in the reserved area. */
export function constructionSiteLayout(footprint: ConstructionFootprint): { x: number; y: number; size: 1 | 2 } {
  const size = footprint.width >= 2 && footprint.height >= 2 ? 2 : 1;
  return { x: footprint.x + (footprint.width - size) / 2,
    y: footprint.y + (footprint.height - size) / 2, size };
}

export function drawConstructionSite(c: CanvasRenderingContext2D, footprint: ConstructionFootprint): void {
  const { x, y, size } = constructionSiteLayout(footprint), image = images.get(size);
  if (!image) return;
  c.imageSmoothingEnabled = false;
  c.drawImage(image, x * 32, y * 32, size * 32, size * 32);
}
