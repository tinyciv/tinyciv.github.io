import { WATER, type World } from './types';

const caches = new WeakMap<World, { revision: number; tiles: World['tiles']; masks: Uint8Array }>();

/** Each bank quadrant follows its nearest dry ground, so biome crossings can
 * retain a warm bank on one side and a tundra bank on the other. */
export function tundraWaterMask(world: World, x: number, y: number): number {
  if (!WATER.has(world.tiles[y * world.width + x].terrain)) return 0;
  let cache = world.revision === undefined ? undefined : caches.get(world);
  if (world.revision !== undefined && (!cache || cache.revision !== world.revision || cache.tiles !== world.tiles)) {
    cache = { revision: world.revision, tiles: world.tiles, masks: new Uint8Array(world.tiles.length).fill(255) };
    caches.set(world, cache);
  }
  const cell = y * world.width + x;
  if (cache && cache.masks[cell] !== 255) return cache.masks[cell];
  let mask = 0;
  for (let q = 0; q < 4; q++) {
    const px = x + (q % 2 ? .75 : .25), py = y + (q >= 2 ? .75 : .25);
    let distance = Infinity, cold = false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
      const t = world.tiles[ny * world.width + nx];
      if (WATER.has(t.terrain)) continue;
      const d = (nx + .5 - px) ** 2 + (ny + .5 - py) ** 2;
      if (d < distance) { distance = d; cold = t.terrain === 'tundra'; }
    }
    if (cold) mask |= 1 << q;
  }
  if (cache) cache.masks[cell] = mask;
  return mask;
}
