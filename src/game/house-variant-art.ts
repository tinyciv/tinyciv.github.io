import type { Building } from './types';
import { punyWorldPixels, type PunyPixels } from './puny-world';
import { nativeHouseTier, NATIVE_BUILDINGS, recolorPunyBuildingPixels, type PunyBuildingPixels } from './puny-building-art';
import { HOUSE_VARIANT_DATA } from './house-variant-data';

export type VariedHouseTier = 2 | 3;
export type HouseVariant = 0 | 1;
type HouseAppearance = Pick<Building, 'id' | 'houseLevel' | 'houseStyle'>;

/** Stable per house, without consuming simulation randomness or changing with
 * faction ownership. Tents and level-four houses retain their original art. */
export function nativeHouseVariant(building: HouseAppearance): HouseVariant | undefined {
  const tier = nativeHouseTier(building);
  if (tier !== 2 && tier !== 3) return undefined;
  const hash = Math.imul(building.id | 0, 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) & 1) as HouseVariant;
}

/** Rearrange the original tier's swatches according to the approved PixelLab
 * variants. Faction colors still come from the exact native gold/cyan/red mask;
 * timber, doors, foundations and silhouette remain the approved pixels. */
export function houseVariantPixels(atlas: PunyPixels, tier: VariedHouseTier, variant: HouseVariant, color: string): PunyBuildingPixels {
  const rect = NATIVE_BUILDINGS.houses[tier].rect;
  const original = recolorPunyBuildingPixels(atlas, rect, color);
  const { palette, variants } = HOUSE_VARIANT_DATA[tier];
  const data = new Uint8ClampedArray(16 * 16 * 4), teamMask = new Uint8Array(16 * 16);
  for (let pixel = 0; pixel < 256; pixel++) {
    const index = variants[variant][pixel];
    if (index === '.') continue;
    const source = palette[parseInt(index, 16)];
    // A dark swatch can occur in both roofing and a newly added window. Only
    // recolor it when the destination also belongs to the native roof mask.
    // Neutral facade pixels use the approved red-reference RGB, not a gold
    // roof swatch that happens to share its palette index.
    teamMask[pixel] = original.teamMask[pixel] & original.teamMask[source];
    if (teamMask[pixel]) data.set(original.data.subarray(source * 4, source * 4 + 4), pixel * 4);
    else {
      const offset = ((rect[1] + 112 + Math.floor(source / 16)) * atlas.width + rect[0] + 160 + source % 16) * 4;
      data.set(atlas.data.subarray(offset, offset + 4), pixel * 4);
    }
  }
  return { width: 16, height: 16, data, teamMask };
}

let cachedAtlas: PunyPixels | undefined;
const sprites = new Map<string, HTMLCanvasElement>();

export function drawHouseVariant(c: CanvasRenderingContext2D, building: HouseAppearance, x: number, y: number, size: number, color: string): boolean {
  const variant = nativeHouseVariant(building), atlas = punyWorldPixels();
  if (variant === undefined || !atlas) return false;
  if (cachedAtlas !== atlas) { sprites.clear(); cachedAtlas = atlas; }
  const tier = nativeHouseTier(building) as VariedHouseTier, key = `${tier}:${variant}:${color}`;
  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas'); sprite.width = sprite.height = 16;
    const context = sprite.getContext('2d')!, pixels = context.createImageData(16, 16);
    pixels.data.set(houseVariantPixels(atlas, tier, variant, color).data);
    context.putImageData(pixels, 0, 0); sprites.set(key, sprite);
  }
  c.imageSmoothingEnabled = false;
  c.drawImage(sprite, x, y, size, size);
  return true;
}
