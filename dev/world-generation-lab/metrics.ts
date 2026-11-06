import { WATER, type World } from '../../src/game/types';
import { ridgeGroundWalkable } from '../../src/game/ridges';

/** Descriptive game-grid measures, not estimates of real-world metres. */
export function landscapeMetrics(world: World) {
  const { width, height, tiles } = world;
  const forest = tiles.map(tile => tile.overlay === 'forest' || tile.overlay === 'jungle');
  const open = tiles.map((tile, i) => !WATER.has(tile.terrain) && !tile.ridge && !forest[i]);
  const land = tiles.filter(tile => !WATER.has(tile.terrain)).length;
  const distances = new Int16Array(tiles.length).fill(32767), queue: number[] = [];
  for (let i = 0; i < tiles.length; i++) if (!open[i]) { distances[i] = 0; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || distances[next] <= distances[cell] + 1) continue;
      distances[next] = distances[cell] + 1; queue.push(next);
    }
  }
  const patches: number[] = [], seen = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    if (!forest[i] || seen[i]) continue;
    const cells = [i]; seen[i] = 1;
    for (let head = 0; head < cells.length; head++) {
      const cell = cells[head], x = cell % width, y = Math.floor(cell / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || !forest[next] || seen[next]) continue;
        seen[next] = 1; cells.push(next);
      }
    }
    patches.push(cells.length);
  }
  patches.sort((a, b) => a - b);
  const openDistances = [...distances].filter((_, i) => open[i]).sort((a, b) => a - b);
  const upper = tiles.flatMap((tile, i) => tile.ridge && ridgeGroundWalkable(world, i % width, Math.floor(i / width)) && !tile.stair ? [i] : []);
  return { seed: world.seed, style: world.generationStyle, land,
    forestFraction: forest.filter(Boolean).length / land,
    openInteriorFraction: openDistances.filter(distance => distance >= 5).length / land,
    openDistanceP90: openDistances[Math.floor(openDistances.length * .9)] ?? 0,
    forestPatches: patches.length, forestPatchMedian: patches[Math.floor(patches.length / 2)] ?? 0,
    forestPatchLargest: patches.at(-1) ?? 0,
    woodedUpperFloors: upper.filter(i => forest[i]).length, upperFloors: upper.length };
}
