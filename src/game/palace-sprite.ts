import { loadPunyWorld } from './puny-world';
import { drawPunyBuildingRegion, NATIVE_BUILDINGS } from './puny-building-art';
import { drawWoodenSettlement, loadWoodenSettlementArt, WOODEN_SETTLEMENT_SIZE } from './wooden-settlement-art';

/** Both settlement stages must be loaded before their art or icons are cached. */
export function loadPalaceSprite(): Promise<void> {
  return Promise.all([loadPunyWorld(), loadWoodenSettlementArt()]).then(() => undefined);
}

export const palaceArtHeight = (level: 1 | 2 = 1, size = 64): number => level === 2 ? size : size * WOODEN_SETTLEMENT_SIZE[1] / WOODEN_SETTLEMENT_SIZE[0];

/** The wooden settlement and stone Keep share the same 2×2 foundation. */
export function drawPalace(c: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, level: 1 | 2 = 1): void {
  if (level !== 2) { drawWoodenSettlement(c, x, y, size, color); return; }
  c.save(); c.translate(x, y); c.scale(size / 64, size / 64); c.imageSmoothingEnabled = false;
  NATIVE_BUILDINGS.palace.buildings.forEach((source, index) =>
    drawPunyBuildingRegion(c, source, index * 32, 0, 32, 64, color));
  c.restore();
}

const icons = new Map<string, string>();
export function palaceIconUrl(color: string, level: 1 | 2 = 1): string {
  const key = `${color}:${level}`;
  let url = icons.get(key);
  if (!url) {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = palaceArtHeight(level);
    drawPalace(canvas.getContext('2d')!, 0, 0, 64, color, level);
    url = canvas.toDataURL(); icons.set(key, url);
  }
  return url;
}
