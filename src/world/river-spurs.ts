import { WATER, type Tile, type World } from '../game/types';

const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const MAX_SPUR_LENGTH = 2;

/** Remove short side branches from a fixed snapshot of the water network.
 * Keeping two arms at each junction retains the main channel and avoids
 * repeatedly peeling a real headwater back through a series of small forks. */
export function pruneShortRiverSpurs(world: World, originalGround: ReadonlyMap<number, Tile>): number[] {
  const { width, height, tiles } = world;
  const wet = Uint8Array.from(tiles, tile => Number(WATER.has(tile.terrain)));
  const neighbors = (cell: number): number[] => {
    const x = cell % width, y = Math.floor(cell / width), result: number[] = [];
    for (const [dx, dy] of DIRECTIONS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && wet[ny * width + nx]) result.push(ny * width + nx);
    }
    return result;
  };
  const degree = Uint8Array.from(tiles, (_, cell) => wet[cell] ? neighbors(cell).length : 0);
  const boundary = (cell: number) => cell % width === 0 || cell % width === width - 1 || cell < width || cell >= tiles.length - width;
  const removable = (cell: number) => tiles[cell].terrain === 'river' && originalGround.has(cell) && !boundary(cell);
  const branches = new Map<number, number[][]>();
  for (let start = 0; start < tiles.length; start++) {
    if (degree[start] !== 1 || !removable(start)) continue;
    const path: number[] = [];
    let previous = -1, cell = start;
    while (path.length <= MAX_SPUR_LENGTH) {
      // Sea/lake mouths and map-edge cuts are connections, never dead spurs.
      if (tiles[cell].terrain !== 'river' || boundary(cell)) break;
      if (degree[cell] >= 3) {
        const group = branches.get(cell) ?? []; group.push(path); branches.set(cell, group); break;
      }
      if (!removable(cell) || degree[cell] === 0 || previous >= 0 && degree[cell] === 1) break;
      path.push(cell);
      const next = neighbors(cell).find(next => next !== previous);
      if (next === undefined) break;
      previous = cell; cell = next;
    }
  }
  const removed: number[] = [];
  for (const [junction, candidates] of branches) {
    // At a tiny headwater fork retain the longer/higher arm as its source.
    // All decisions use the original graph, so traversal order cannot erode it.
    candidates.sort((a, b) => a.length - b.length || tiles[a[0]].elevation - tiles[b[0]].elevation || a[0] - b[0]);
    for (const path of candidates.slice(0, degree[junction] - 2)) removed.push(...path);
  }
  for (const cell of removed) tiles[cell] = originalGround.get(cell)!;
  return removed.sort((a, b) => a - b);
}
