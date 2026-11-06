import { type World, tileAt } from './types';
import { type TerrainQuad } from './terrain';
import { ridgeLevel, type StairDirection } from './ridges';

/** Native authored sprites, indexed by UPHILL travel, not boundary side.
 * A northward ascent uses the south-facing cliff's stair, never a rotated sprite. */
export const STAIR_SOURCES: Record<StairDirection, readonly [number, number]> = {
  north: [96, 96], east: [80, 80], south: [96, 64], west: [112, 80],
};

/** These ledges occupy the full boundary tile, unlike the half-tile water rim.
 * Cutting only the outward quarter would erase the north and side cliff faces. */
export function ridgeQuads(world: World, x: number, y: number): TerrainQuad[] | undefined {
  const tile = tileAt(world, x, y);
  if (!tile?.ridge) return;
  if (tile.stair) {
    const [sx, sy] = STAIR_SOURCES[tile.stair];
    return [0, 1, 2, 3].map(q => ({ sx: sx + q % 2 * 8, sy: sy + Math.floor(q / 2) * 8, dx: q % 2 * 8, dy: Math.floor(q / 2) * 8 }));
  }
  const level = ridgeLevel(tile);
  const same = (nx: number, ny: number) => {
    const neighbor = tileAt(world, nx, ny);
    return neighbor?.ridge === tile.ridge && ridgeLevel(neighbor) >= level;
  };
  const north = same(x, y - 1), south = same(x, y + 1), west = same(x - 1, y), east = same(x + 1, y);
  let sx = west ? east ? 1 : 2 : 0, sy = 4 + (north ? south ? 1 : 2 : 0);
  if (north && south && west && east) {
    for (const [dx, dy, tx, ty] of [[-1,-1,3,4],[1,-1,4,4],[-1,1,3,5],[1,1,4,5]]) {
      if (!same(x + dx, y + dy)) { sx = tx; sy = ty; break; }
    }
  }
  return [0, 1, 2, 3].map(q => ({ sx: sx * 16 + q % 2 * 8, sy: sy * 16 + Math.floor(q / 2) * 8, dx: q % 2 * 8, dy: Math.floor(q / 2) * 8 }));
}
