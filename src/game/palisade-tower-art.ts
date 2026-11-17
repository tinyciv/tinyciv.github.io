import { runtimeArtUrl } from './runtime-art';
import { towerBannerImage } from './tower-banner-art';
/** Default wooden watchtower, both standalone and mounted on palisades. */
export const PALISADE_TOWER_SPRITE = { width: 16, height: 28, groundAnchor: [8, 28] } as const;
let image: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadPalisadeTowerArt(): Promise<void> {
  return loading ??= (async () => {
    const source = new Image();
    source.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/buildings/palisade-tower.png`);
    await source.decode();
    if (source.naturalWidth !== PALISADE_TOWER_SPRITE.width || source.naturalHeight !== PALISADE_TOWER_SPRITE.height)
      throw new Error('Invalid palisade watchtower artwork.');
    image = source;
  })();
}

/** The visible foundation meets the ground at the bottom of its tile. */
export function drawPalisadeTower(c: CanvasRenderingContext2D, x = 0, y = 0, size = 32, color = '#cb381b'): void {
  if (!image) return;
  const height = size * PALISADE_TOWER_SPRITE.height / PALISADE_TOWER_SPRITE.width;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(towerBannerImage(image, color), x, y + size - height, size, height);
  c.restore();
}
