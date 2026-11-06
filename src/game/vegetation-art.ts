import { WATER, type Tile, type TreeClass } from './types';

type Sheet = 'medieval' | 'marsh-2A' | 'marsh-2B' | 'marsh-2C' | 'marsh-2D';
export interface VegetationSprite { sheet: Sheet; x: number; y: number; width: number; height: number }
const sprite = (sheet: Sheet, x: number, y = 0, height = 16): VegetationSprite => ({ sheet, x, y, width: 16, height });
const files: Record<Sheet, string> = {
  medieval: 'medieval-nature.png',
  'marsh-2A': 'marsh/2A.png',
  'marsh-2B': 'marsh/2B.png',
  'marsh-2C': 'marsh/2C.png',
  'marsh-2D': 'marsh/2D.png',
};
const sheets = new Map<Sheet, HTMLImageElement>();
let loading: Promise<void> | undefined;

export function loadVegetationArt(): Promise<void> {
  return loading ??= Promise.all(Object.entries(files).map(async ([key, file]) => {
    const image = new Image(); image.src = `${import.meta.env.BASE_URL}assets/vegetation/${file}`;
    await image.decode(); sheets.set(key as Sheet, image);
  })).then(() => undefined);
}

/** Native Medieval World silhouettes, grouped into compatible local families.
 * Every tall tree uses its complete16×32 source rectangle and ground footing. */
export const TREE_FAMILIES: Readonly<Record<TreeClass, readonly VegetationSprite[]>> = {
  tropical: [sprite('medieval', 0, 48), sprite('medieval', 0, 64, 32), sprite('medieval', 32, 64, 32)],
  dry: [sprite('medieval', 32, 0), sprite('medieval', 32, 16, 32), sprite('medieval', 96, 48), sprite('medieval', 96, 64, 32)],
  temperate: [sprite('medieval', 0, 0), sprite('medieval', 0, 16, 32), sprite('medieval', 64, 96), sprite('medieval', 64, 112, 32)],
  conifer: [sprite('medieval', 64, 0), sprite('medieval', 96, 0), sprite('medieval', 64, 16, 32), sprite('medieval', 96, 16, 32)],
  snowy: [sprite('medieval', 0, 144), sprite('medieval', 32, 144), sprite('medieval', 0, 160, 32), sprite('medieval', 32, 160, 32)],
};
const COASTAL_PALMS = TREE_FAMILIES.tropical.slice(0, 2);
export const MARSH_HEIGHT_TILES = 2.45;
export const MARSH_WIDTH_TILES = 2;
export const MARSH_PLANTS: readonly VegetationSprite[] = ['marsh-2A', 'marsh-2B', 'marsh-2C', 'marsh-2D']
  .map(sheet => ({ sheet: sheet as Sheet, x: 0, y: 0, width: 32, height: 48 }));

/** Stable source selection never consumes the simulation's random stream. */
export function vegetationVariant(tile: Tile): VegetationSprite | undefined {
  const variation = Math.floor(tile.variation * 0x1000000) >>> 0;
  if (tile.marsh) return WATER.has(tile.terrain) ? undefined : MARSH_PLANTS[variation % MARSH_PLANTS.length];
  if (tile.palm || tile.overlay === 'forest' || tile.overlay === 'jungle') {
    const family = tile.treeClass ?? (tile.palm || tile.overlay === 'jungle' ? 'tropical'
      : tile.terrain === 'tundra' ? 'snowy' : tile.terrain === 'desert' ? 'dry' : 'temperate');
    const choices = tile.palm ? COASTAL_PALMS : TREE_FAMILIES[family];
    return choices[variation % choices.length];
  }
  return undefined;
}

/** Crowns may overhang water, but their lower-center anchor stays on dry land.
 * The approved marsh proportions are independent of the source PNG aspect. */
export function vegetationArtBounds(tile: Tile, size = 32): { x: number; y: number; width: number; height: number } {
  if (tile.marsh && !WATER.has(tile.terrain)) return {
    x: size * (1 - MARSH_WIDTH_TILES) / 2,
    y: size * (15 / 16 - MARSH_HEIGHT_TILES),
    width: size * MARSH_WIDTH_TILES,
    height: size * MARSH_HEIGHT_TILES,
  };
  const source = vegetationVariant(tile), height = source ? size * source.height / 16 : size;
  return { x: 0, y: size - height, width: size, height };
}

export function drawVegetation(c: CanvasRenderingContext2D, tile: Tile, x: number, y: number, size: number): boolean {
  const source = vegetationVariant(tile);
  if (!source) return false;
  const bounds = vegetationArtBounds(tile, size);
  c.imageSmoothingEnabled = false;
  const image = sheets.get(source.sheet);
  if (!image) return false;
  c.drawImage(image, source.x, source.y, source.width, source.height,
    Math.round(x) + bounds.x, tile.marsh ? Math.round(y) + bounds.y : Math.round(y + bounds.y), bounds.width, bounds.height);
  return true;
}

/** Tall crowns share the small trees' footing. A walker passes in front only
 * after their feet cross the trunk's lower edge, not the crown's top edge. */
export const vegetationRenderDepth = (tileY: number): number => tileY + 15 / 16;

/** The adjacent atlas cell is the matching stump. Tall variants have empty
 * upper cells, so retain only the bottom native 16px cell. */
export function vegetationStump(tile: Tile): { x: number; y: number } | undefined {
  const source = vegetationVariant(tile);
  return source?.sheet === 'medieval' ? { x: source.x + 16, y: source.y + source.height - 16 } : undefined;
}

export function drawTreeStump(c: CanvasRenderingContext2D, stump: { sourceX: number; sourceY: number }, x: number, y: number, size: number): void {
  const image = sheets.get('medieval');
  if (!image) return;
  c.imageSmoothingEnabled = false;
  c.drawImage(image, stump.sourceX, stump.sourceY, 16, 16, Math.round(x), Math.round(y), size, size);
}
