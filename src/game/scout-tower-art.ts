import { runtimeArtUrl } from './runtime-art';
import { PALISADE_TOWER_SPRITE } from './palisade-tower-art';

let image: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadScoutTowerArt(): Promise<void> {
  return loading ??= (async () => {
    const source = new Image();
    source.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/buildings/scout-tower.png`);
    await source.decode();
    if (source.naturalWidth !== PALISADE_TOWER_SPRITE.width || source.naturalHeight !== PALISADE_TOWER_SPRITE.height)
      throw new Error('Invalid scout tower artwork.');
    image = source;
  })();
}

export function drawScoutTower(context: CanvasRenderingContext2D): void {
  if (!image) return;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, -24, 32, 56);
}
