import { runtimeArtUrl } from './runtime-art';
import { towerBannerImage } from './tower-banner-art';
/** Approved 16×28 watchtower; its bottom-center anchor matches the wall tile. */
export const STONE_WALL_TOWER_SPRITE = { width: 16, height: 28, groundAnchor: [8, 28] } as const;
let image: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadStoneWallTowerArt(): Promise<void> {
  return loading ??= (async () => {
    const source = new Image();
    source.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/buildings/stone-wall-tower.png`);
    await source.decode();
    if (source.naturalWidth !== STONE_WALL_TOWER_SPRITE.width || source.naturalHeight !== STONE_WALL_TOWER_SPRITE.height)
      throw new Error('Invalid stone wall watchtower artwork.');
    image = source;
  })();
}

/** Keep neutral stone and wood unchanged while the banner follows ownership. */
export function drawStoneWallTower(c: CanvasRenderingContext2D, x = 0, y = 0, size = 32, color = '#cb381b'): void {
  if (!image) return;
  const height = size * STONE_WALL_TOWER_SPRITE.height / STONE_WALL_TOWER_SPRITE.width;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(towerBannerImage(image, color), x, y + size - height, size, height);
  c.restore();
}
