import type { World } from './types';

export type FordAxis = 'vertical' | 'horizontal' | 'diagonal';
export type FordStyle = 'green' | 'mixed' | 'tan';
type Rect = readonly [number, number, number, number];
interface Stone { rect: Rect; x: number; y: number; tan: boolean }

/** Original Puny pebbles, cropped tightly instead of shrinking their 16px cell.
 * Individual cuts are fragments of the source cluster, not new pack sprites. */
export const FORD_STONES = {
  cluster: [19, 423, 10, 7] as Rect,
  broad: [19, 425, 7, 5] as Rect,
  small: [24, 423, 5, 4] as Rect,
};
/** Source olive stone shades → native Puny wall/sandstone shades. */
export const FORD_TAN_PALETTE = [
  [0x646b41, 0x67512a], [0x787f4f, 0x807c5a],
  [0xa6ae78, 0x938f69], [0xb2ba82, 0xd8bf8e],
] as const;
const tanPalette = new Map<number, number>(FORD_TAN_PALETTE);
const cache = new WeakMap<CanvasImageSource, Map<string, HTMLCanvasElement>>();
type StonePlacement = readonly [keyof typeof FORD_STONES, number, number];

/** Each arrangement is drawn on the original 16px grid. Stones stay upright;
 * only their positions change with the direction of the crossing. */
const HORIZONTAL_LAYOUTS: readonly (readonly StonePlacement[])[] = [
  [['broad', 0, 2], ['broad', 5, 9], ['small', 11, 3]],
  [['small', 0, 8], ['broad', 5, 1], ['small', 11, 10]],
  [['cluster', 0, 2], ['small', 8, 10], ['small', 11, 1]],
  [['small', 1, 1], ['broad', 4, 9], ['broad', 9, 2]],
  [['broad', 0, 7], ['small', 6, 1], ['small', 11, 8]],
  [['small', 0, 2], ['small', 4, 10], ['broad', 9, 5]],
];
export const FORD_LAYOUT_COUNT = HORIZONTAL_LAYOUTS.length;

/** Cross between the opposite dry banks, not along the watercourse. */
export function fordCrossingAxis(world: World, x: number, y: number): FordAxis {
  const tile = world.tiles[y * world.width + x];
  if (tile?.terrain === 'river' && tile.overlay === 'ford' && tile.fordAxis) return tile.fordAxis;
  const dry = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < world.width && ty < world.height
    && !['ocean', 'coast', 'river', 'lake'].includes(world.tiles[ty * world.width + tx].terrain);
  const north = dry(x, y - 1), south = dry(x, y + 1), west = dry(x - 1, y), east = dry(x + 1, y);
  if (north && south) return 'vertical';
  if (west && east) return 'horizontal';
  // The generator normally uses opposite banks. This keeps custom junctions
  // and irregular channels readable without rewriting their geography.
  if ((north && west) || (south && east)) return 'diagonal';
  return Number(north) + Number(south) >= Number(west) + Number(east) ? 'vertical' : 'horizontal';
}

export function fordStoneLayout(axis: FordAxis, variation = 0, style: FordStyle = 'mixed'): Stone[] {
  const variant = Math.min(FORD_LAYOUT_COUNT - 1, Math.max(0, Math.floor(variation * FORD_LAYOUT_COUNT)));
  return HORIZONTAL_LAYOUTS[variant].map(([kind, px, py], index) => {
    const rect = FORD_STONES[kind], width = rect[2], height = rect[3];
    // Transpose centers, not sprites: all crops retain Puny World's light source.
    const x = axis === 'vertical' ? Math.round(py + height / 2 - width / 2)
      : axis === 'diagonal' ? Math.round((px + py) / 2) : px;
    const y = axis === 'vertical' ? Math.round(px + width / 2 - height / 2)
      : axis === 'diagonal' ? Math.round(px * .72 + py * .28) : py;
    return { rect, x: Math.max(0, Math.min(16 - width, x)), y: Math.max(0, Math.min(16 - height, y)),
      tan: style === 'tan' || style === 'mixed' && (index + variant) % 3 === 1 };
  });
}

function stoneSprite(atlas: CanvasImageSource, rect: Rect, tan: boolean): HTMLCanvasElement {
  let sprites = cache.get(atlas); if (!sprites) { sprites = new Map(); cache.set(atlas, sprites); }
  const key = `${rect.join(',')}:${tan}`;
  const cached = sprites.get(key); if (cached) return cached;
  const canvas = document.createElement('canvas'); canvas.width = rect[2]; canvas.height = rect[3];
  const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false;
  c.drawImage(atlas, ...rect, 0, 0, rect[2], rect[3]);
  if (tan) {
    const pixels = c.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (!pixels.data[i + 3]) continue;
      const color = tanPalette.get(pixels.data[i] * 65536 + pixels.data[i + 1] * 256 + pixels.data[i + 2]);
      if (color === undefined) continue;
      pixels.data[i] = color >>> 16; pixels.data[i + 1] = color >>> 8 & 255; pixels.data[i + 2] = color & 255;
    }
    c.putImageData(pixels, 0, 0);
  }
  sprites.set(key, canvas); return canvas;
}

/** Transparent scenery at exactly the terrain's 16px design grid. Water and
 * shore animation remain the terrain renderer's responsibility underneath. */
export function drawFordStones(c: CanvasRenderingContext2D, atlas: CanvasImageSource | undefined,
  x: number, y: number, size: number, axis: FordAxis = 'vertical', variation = 0, style: FordStyle = 'mixed'): void {
  if (!atlas) return;
  c.save(); c.translate(x, y); c.scale(size / 16, size / 16); c.imageSmoothingEnabled = false;
  for (const stone of fordStoneLayout(axis, variation, style))
    c.drawImage(stoneSprite(atlas, stone.rect, stone.tan), stone.x, stone.y);
  c.restore();
}
