import { runtimeArtUrl } from './runtime-art';
import { isMarshRushTile, MarshRushBand, type MarshRushPlacement } from './marsh-rush-placement';
import { type Tile, type TreeClass } from './types';

type Sheet = 'medieval' | 'rushes';
export interface VegetationSprite { sheet: Sheet; x: number; y: number; width: number; height: number }
const sprite = (sheet: Sheet, x: number, y = 0, height = 16): VegetationSprite => ({ sheet, x, y, width: 16, height });
const files: Record<Sheet, string> = {
  medieval: 'medieval-nature.png',
  rushes: 'marsh/rushes.png',
};
const sheets = new Map<Sheet, HTMLImageElement>();
let loading: Promise<void> | undefined;

export function loadVegetationArt(): Promise<void> {
  return loading ??= Promise.all(Object.entries(files).map(async ([key, file]) => {
    const image = new Image(); image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/vegetation/${file}`);
    await image.decode();
    if (key === 'rushes' && (image.naturalWidth !== 112 || image.naturalHeight !== 96))
      throw new Error('Invalid blue-green marsh rush atlas');
    sheets.set(key as Sheet, image);
  })).then(() => undefined);
}

/** Native Medieval World silhouettes, grouped into compatible local families.
 * Every tall tree uses its complete16×32 source rectangle and ground footing. */
export const OLIVE_RESOURCE_VARIANTS: readonly VegetationSprite[] = [
  sprite('medieval', 64, 96), sprite('medieval', 64, 112, 32),
];

/** Olive-colored trees are reserved for resource groves, not ordinary forests. */
export const TREE_FAMILIES: Readonly<Record<TreeClass, readonly VegetationSprite[]>> = {
  tropical: [sprite('medieval', 0, 48), sprite('medieval', 0, 64, 32), sprite('medieval', 32, 64, 32)],
  dry: [sprite('medieval', 32, 0), sprite('medieval', 32, 16, 32), sprite('medieval', 96, 48), sprite('medieval', 96, 64, 32)],
  temperate: [sprite('medieval', 0, 0), sprite('medieval', 0, 16, 32)],
  conifer: [sprite('medieval', 64, 0), sprite('medieval', 96, 0), sprite('medieval', 64, 16, 32), sprite('medieval', 96, 16, 32)],
  snowy: [sprite('medieval', 0, 144), sprite('medieval', 32, 144), sprite('medieval', 0, 160, 32), sprite('medieval', 32, 160, 32)],
};
const COASTAL_PALMS = TREE_FAMILIES.tropical.slice(0, 2);
const RUSH_HEIGHT_SCALE = 1.5;
const SHOOT_WIDTH = 8;
const SHOOT_X = 80;
const RUSH_FRAMES = [
  { y: 0, height: 16, count: 5 }, { y: 16, height: 16, count: 5 },
  { y: 32, height: 32, count: 5 }, { y: 64, height: 32, count: 4 },
].map(({ y, height, count }) => Array.from({ length: count }, (_, frame) => sprite('rushes', frame * 16, y, height)));

/** Stable source selection never consumes the simulation's random stream. */
export function vegetationVariant(tile: Tile, rush?: MarshRushPlacement): VegetationSprite | undefined {
  if (tile.marsh) {
    if (!isMarshRushTile(tile)) return;
    const frames = RUSH_FRAMES[rush?.band ?? MarshRushBand.Tall];
    return frames[Math.floor(tile.variation * 65536) % frames.length];
  }
  const variation = Math.floor(tile.variation * 0x1000000) >>> 0;
  if (tile.palm || tile.overlay === 'forest' || tile.overlay === 'jungle') {
    const family = tile.terrain === 'tundra' ? 'snowy' : tile.treeClass === 'snowy' ? 'conifer' : tile.treeClass ?? (tile.palm || tile.overlay === 'jungle' ? 'tropical'
      : tile.terrain === 'desert' ? 'dry' : 'temperate');
    const choices = tile.palm && tile.terrain !== 'tundra' ? COASTAL_PALMS : TREE_FAMILIES[family];
    return choices[variation % choices.length];
  }
  return undefined;
}

/** Marsh cores are one tile wide. Optional side shoots share their footing. */
export function vegetationArtBounds(tile: Tile, size = 32, rush?: MarshRushPlacement, source = vegetationVariant(tile, rush)) {
  if (source?.sheet === 'rushes') {
    const height = size * source.height / 16 * RUSH_HEIGHT_SCALE;
    const left = rush?.left ? size / 2 : 0, right = rush?.right ? size / 2 : 0;
    return { x: -left, y: size * 15 / 16 - height, width: size + left + right, height };
  }
  const height = source ? size * source.height / 16 : size;
  return { x: 0, y: size - height, width: size, height };
}

export function drawVegetation(c: CanvasRenderingContext2D, tile: Tile, x: number, y: number, size: number, rush?: MarshRushPlacement): boolean {
  const source = vegetationVariant(tile, rush);
  if (!source) return false;
  const image = sheets.get(source.sheet);
  if (!image) return false;
  const bounds = vegetationArtBounds(tile, size, rush, source);
  c.imageSmoothingEnabled = false;
  if (source.sheet === 'rushes') {
    const dx = Math.round(x), dy = Math.round(y) + bounds.y, half = size / 2;
    const shootX = SHOOT_X + (source.height === 32 ? rush?.shootVariant ?? 0 : 0) * 16;
    if (rush?.left) c.drawImage(image, shootX, source.y, SHOOT_WIDTH, source.height, dx - half, dy, half, bounds.height);
    if (rush?.right) c.drawImage(image, shootX + SHOOT_WIDTH, source.y, SHOOT_WIDTH, source.height, dx + size, dy, half, bounds.height);
    c.drawImage(image, source.x, source.y, source.width, source.height, dx, dy, size, bounds.height);
    return true;
  }
  c.drawImage(image, source.x, source.y, source.width, source.height,
    Math.round(x) + bounds.x, Math.round(y + bounds.y), bounds.width, bounds.height);
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
