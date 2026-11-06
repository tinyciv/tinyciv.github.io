import { type Tile, type World } from '../game/types';

export const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

/** Independent streams keep environmental detail from changing city placement. */
export function environmentRandom(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/** Cardinal distance with explicit row boundaries; absent sources remain far away. */
export function terrainDistance(world: Pick<World, 'width' | 'height' | 'tiles'>,
  source: (tile: Tile) => boolean, limit = 32766): Int16Array {
  const { width, height, tiles } = world, distance = new Int16Array(tiles.length).fill(32767), queue: number[] = [];
  for (let cell = 0; cell < tiles.length; cell++) if (source(tiles[cell])) { distance[cell] = 0; queue.push(cell); }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
    if (distance[cell] >= limit) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || distance[next] <= distance[cell] + 1) continue;
      distance[next] = distance[cell] + 1; queue.push(next);
    }
  }
  return distance;
}

export function settlementCoreMask(world: World): Uint8Array {
  const mask = new Uint8Array(world.tiles.length);
  for (const site of [...world.spawns, ...(world.secondarySpawns ?? [])]) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = Math.floor(site.x) + dx, y = Math.floor(site.y) + dy;
      if (x >= 0 && y >= 0 && x < world.width && y < world.height) mask[y * world.width + x] = 1;
    }
  }
  return mask;
}
