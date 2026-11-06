import { canTraverseEdge, canWalk, traversable, withNavigationFrame } from './pathfinding';
import { buildingHeight, buildingPresent, buildingReady, buildingWidth, type GameState, type Point, type RegionalResource, type World } from './types';

export const SPECIALTY_RADIUS = 8;
export const SPECIALTY_TRADE_BONUS = .05;
const RESOURCES: RegionalResource[] = ['clay', 'iron', 'stone', 'salt', 'fish'];
const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const caches = new WeakMap<World, { tiles: World['tiles']; revision: number | undefined; access: string; cities: Map<string, RegionalResource[]> }>();

/** Three accessible deposit cells establish a local trade specialty. Deposits
 * may be worked from the next land cell (quarries and shore fisheries), but a
 * nearby resource across an uncrossable channel cannot support the city. */
export function citySpecialties(world: World, city: Point & { faction?: number }, state?: GameState): readonly RegionalResource[] {
  if (state) return withNavigationFrame(state, () => collectSpecialties(world, city, state));
  return collectSpecialties(world, city);
}

function collectSpecialties(world: World, city: Point & { faction?: number }, state?: GameState): readonly RegionalResource[] {
  const cx = Math.floor(city.x), cy = Math.floor(city.y), start = cy * world.width + cx;
  const faction = city.faction ?? 0, key = `${start}:${faction}`;
  const access = state ? state.buildings.map(b => `${b.kind}:${b.x}:${b.y}:${b.faction}:${Number(buildingPresent(b))}:${Number(buildingReady(b))}`).join('|')
    + state.factions.map(f => `${f.id}:${f.relation}`).join('|') : '';
  let cache = caches.get(world);
  if (!cache || cache.tiles !== world.tiles || cache.revision !== world.revision || cache.access !== access) {
    cache = { tiles: world.tiles, revision: world.revision, access, cities: new Map() }; caches.set(world, cache);
  }
  if (world.revision !== undefined && cache.cities.has(key)) return cache.cities.get(key)!;
  const queue: number[] = [], seen = new Set<number>(), deposits = new Set<number>();
  const open = (x: number, y: number) => state ? canWalk(state, x, y, faction) : traversable(world, x, y);
  const palace = state?.buildings.find(b => b.kind === 'palace' && b.x === cx && b.y === cy && buildingReady(b));
  if (palace) {
    // Start at actual palace exits, since its own footprint is solid.
    const width = buildingWidth(palace), height = buildingHeight(palace);
    for (let y = cy - 1; y <= cy + height; y++) for (let x = cx - 1; x <= cx + width; x++) {
      const side = (x >= cx && x < cx + width) !== (y >= cy && y < cy + height);
      if (side && open(x, y)) { const cell = y * world.width + x; queue.push(cell); seen.add(cell); }
    }
  } else if (open(cx, cy)) { queue.push(start); seen.add(start); }
  const counts = new Map<RegionalResource, number>();
  const deposit = (cell: number) => {
    const resource = world.tiles[cell]?.resource;
    if (!resource || deposits.has(cell)) return;
    deposits.add(cell); counts.set(resource, (counts.get(resource) ?? 0) + 1);
  };
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % world.width, y = Math.floor(cell / world.width);
    deposit(cell);
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || Math.hypot(nx - cx, ny - cy) > SPECIALTY_RADIUS) continue;
      deposit(next);
      if (seen.has(next) || !open(nx, ny) || !canTraverseEdge(world, { x, y }, { x: nx, y: ny })) continue;
      seen.add(next); queue.push(next);
    }
  }
  const result = RESOURCES.filter(resource => (counts.get(resource) ?? 0) >= 3);
  cache.cities.set(key, result);
  return result;
}

/** Complementary specialties reward connecting different regions; matching
 * resource lists do not multiply ordinary distance income. */
export function regionalTradeMultiplier(world: World, a: Point & { faction?: number }, b: Point & { faction?: number }, state?: GameState): number {
  const first = new Set(citySpecialties(world, a, state)), second = new Set(citySpecialties(world, b, state));
  const complementary = RESOURCES.filter(resource => first.has(resource) !== second.has(resource)).length;
  return 1 + complementary * SPECIALTY_TRADE_BONUS;
}
