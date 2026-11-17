import { worldChangesSince, worldRevisions, worldStructureRevision } from './world-revisions';
import { entityStore } from './entity-store';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';
import { canTraverseEdge, canWalk, traversable, withNavigationFrame, navigationRouteStamp, navigationRouteUnchanged, type NavigationRouteStamp } from './pathfinding';
import { buildingHeight, buildingPresent, buildingReady, buildingWidth, type GameState, type Point, type RegionalResource, type World } from './types';

export const SPECIALTY_RADIUS = 8;
export const SPECIALTY_TRADE_BONUS = .05;
const RESOURCES: RegionalResource[] = ['clay', 'iron', 'stone', 'salt', 'fish'];
const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
interface SpecialtyEntry {
  result: RegionalResource[]; dependencies: string; cursor: number;
  resources: Map<number, RegionalResource | undefined>; stamp?: NavigationRouteStamp;
  palace?: GameState['buildings'][number]; ready: boolean;
}
const caches = new WeakMap<object, { world: World; tiles: World['tiles']; width: number; height: number; cities: Map<string, SpecialtyEntry> }>();

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
  const owner = state ?? world;
  let cache = caches.get(owner);
  if (!cache || cache.world !== world || cache.tiles !== world.tiles || cache.width !== world.width || cache.height !== world.height) {
    cache = { world, tiles: world.tiles, width: world.width, height: world.height, cities: new Map() }; caches.set(owner, cache);
  }
  const dependencies = `${worldRevisions(world).geometry}|${worldStructureRevision(world)}|${state ? `${entityStore(state).buildings.revision}:${structureChangeRevision(state)}:`
    + state.factions.map(f => `${f.id}:${f.relation}`).join('|') : ''}`;
  const palace = state && entityStore(state).buildings.query('palace').find(b => b.kind === 'palace' && b.x === cx && b.y === cy && buildingReady(b));
  const old = cache.cities.get(key), changes = worldChangesSince(world, old?.cursor);
  let resourcesChanged = !old;
  if (old) {
    const inspect = (cell: number) => {
      if (old.resources.has(cell) && old.resources.get(cell) !== world.tiles[cell]?.resource) resourcesChanged = true;
    };
    if (changes.full) for (const cell of old.resources.keys()) inspect(cell);
    else for (const cell of changes.cells) inspect(cell);
    const topologyUnchanged = old.dependencies === dependencies && (!state || simulationReadsActive(state))
      || !!state && !!old.stamp && navigationRouteUnchanged(state, faction, old.stamp, false);
    if (!resourcesChanged && topologyUnchanged && old.palace === palace) {
      old.dependencies = dependencies; old.cursor = changes.revision;
      return old.result;
    }
  }
  const queue: number[] = [], seen = new Set<number>(), deposits = new Set<number>();
  const open = (x: number, y: number) => state ? canWalk(state, x, y, faction) : traversable(world, x, y);
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
  const resources = new Map<number, RegionalResource | undefined>();
  for (let y = Math.max(0, cy - SPECIALTY_RADIUS); y <= Math.min(world.height - 1, cy + SPECIALTY_RADIUS); y++)
    for (let x = Math.max(0, cx - SPECIALTY_RADIUS); x <= Math.min(world.width - 1, cx + SPECIALTY_RADIUS); x++) {
      const cell = y * world.width + x; resources.set(cell, world.tiles[cell]?.resource);
    }
  cache.cities.set(key, { result, dependencies, cursor: changes.revision, resources, palace, ready: !!palace,
    stamp: state ? navigationRouteStamp(state, faction, resources.keys()) : undefined });
  return result;
}

/** Complementary specialties reward connecting different regions; matching
 * resource lists do not multiply ordinary distance income. */
export function regionalTradeMultiplier(world: World, a: Point & { faction?: number }, b: Point & { faction?: number }, state?: GameState): number {
  const first = new Set(citySpecialties(world, a, state)), second = new Set(citySpecialties(world, b, state));
  const complementary = RESOURCES.filter(resource => first.has(resource) !== second.has(resource)).length;
  return 1 + complementary * SPECIALTY_TRADE_BONUS;
}
