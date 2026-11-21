import { loadPunyWorld } from './puny-world';
import { drawPunyBuildingRegion, NATIVE_BUILDINGS } from './puny-building-art';
import { drawWoodenSettlement, loadWoodenSettlementArt } from './wooden-settlement-art';
import { SETTLEMENT_SPRITE_WIDTH, SETTLEMENT_TIER_ART, settlementSpriteHeight } from './settlement-art-layout';
import { drawSettlementTier, loadSettlementTierArt } from './settlement-tier-sprite';
import type { Building } from './types';

/** Load the original buildings and the civic upgrades before baking their sprites. */
export function loadPalaceSprite(): Promise<void> {
  return Promise.all([loadPunyWorld(), loadWoodenSettlementArt(), loadSettlementTierArt()]).then(() => undefined);
}

export const palaceArtHeight = (level: 1 | 2 = 1, size = 64, tier: Building['settlementTier'] = 0): number =>
  size * settlementSpriteHeight(level, tier) / SETTLEMENT_SPRITE_WIDTH;

/** Draw from the top left of the art. Civic tier sets the height, and defenses set the material. */
export function drawPalace(c: CanvasRenderingContext2D, x: number, y: number, size: number, color: string,
  level: 1 | 2 = 1, tier: Building['settlementTier'] = 0): void {
  if (tier) {
    const { file, height } = SETTLEMENT_TIER_ART[level][tier];
    c.save(); c.imageSmoothingEnabled = false;
    drawSettlementTier(c, file, x, y, size, size * height / SETTLEMENT_SPRITE_WIDTH, color);
    c.restore(); return;
  }
  if (level !== 2) { drawWoodenSettlement(c, x, y, size, color); return; }
  c.save(); c.translate(x, y); c.scale(size / 64, size / 64); c.imageSmoothingEnabled = false;
  NATIVE_BUILDINGS.palace.buildings.forEach((source, index) =>
    drawPunyBuildingRegion(c, source, index * 32, 0, 32, 64, color));
  c.restore();
}

const icons = new Map<string, string>();
export function palaceIconUrl(color: string, level: 1 | 2 = 1, tier: Building['settlementTier'] = 0): string {
  const key = `${color}:${level}:${tier}`;
  let url = icons.get(key);
  if (!url) {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = palaceArtHeight(level, 64, tier);
    drawPalace(canvas.getContext('2d')!, 0, 0, 64, color, level, tier);
    url = canvas.toDataURL(); icons.set(key, url);
  }
  return url;
}
