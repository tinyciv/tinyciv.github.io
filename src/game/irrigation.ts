import { type Building, type GameState, type World, buildingReady, tileAt } from './types';

export const IRRIGATION_GOLD = 35;
export const IRRIGATION_RADIUS = 2;
export const IRRIGATION_YIELD_MULTIPLIER = 2;
export const IRRIGATION_MOVEMENT_MULTIPLIER = .5;

export function isFreshwaterSource(state: GameState, x: number, y: number): boolean {
  const terrain = tileAt(state.world, x, y)?.terrain;
  return terrain === 'river' || terrain === 'lake';
}

/** Cardinal connections keep each new segment attached to water or a previous
 * segment. Pending segments count so one continuous drag can be queued. */
export function irrigationConnects(state: GameState, x: number, y: number): boolean {
  return [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) =>
    isFreshwaterSource(state, x + dx, y + dy) || state.buildings.some(building =>
      building.hp > 0 && building.kind === 'irrigation' && building.x === x + dx && building.y === y + dy));
}

/** Tile-center offsets shared by the harvest bonus and placement highlight. */
export const IRRIGATION_OFFSETS: readonly (readonly [number, number])[] = Array.from(
  { length: (IRRIGATION_RADIUS * 2 + 1) ** 2 }, (_, index) => [index % (IRRIGATION_RADIUS * 2 + 1) - IRRIGATION_RADIUS, Math.floor(index / (IRRIGATION_RADIUS * 2 + 1)) - IRRIGATION_RADIUS] as const,
).filter(([x, y]) => x * x + y * y <= IRRIGATION_RADIUS * IRRIGATION_RADIUS);

interface IrrigationCoverage {
  world: World;
  buildings: readonly Building[];
  count: number;
  width: number;
  height: number;
  revision: number | undefined;
  checkedAt: number;
  signature: string;
  ditches: ReadonlySet<number>;
  coverage: Uint8Array;
}
const caches = new WeakMap<GameState, IrrigationCoverage>();

/** Lifecycle hooks may edit a structure within the current tick. Retain the
 * bitmap until scalar validation proves that ditch topology actually changed. */
export function invalidateIrrigation(state: GameState): void {
  const cached = caches.get(state);
  if (cached) cached.checkedAt = NaN;
}

/** Validate at most once per simulation time/revision, then answer each plot
 * in O(1). Revisionless fixture worlds deliberately retain scalar validation. */
export function prepareIrrigation(state: GameState): IrrigationCoverage {
  const world = state.world, old = caches.get(state);
  const compatible = old?.world === world && old.width === world.width && old.height === world.height;
  if (compatible && world.revision !== undefined && old!.buildings === state.buildings && old!.count === state.buildings.length
    && old!.revision === world.revision && old!.checkedAt === state.time) return old!;
  const keys: number[] = [];
  for (const building of state.buildings) {
    if (building.kind !== 'irrigation' || !buildingReady(building)) continue;
    const x = Math.floor(building.x), y = Math.floor(building.y);
    if (x >= 0 && y >= 0 && x < world.width && y < world.height) keys.push(y * world.width + x);
  }
  keys.sort((a, b) => a - b);
  const signature = keys.join(','), unchanged = compatible && old!.signature === signature;
  const ditches = unchanged ? old!.ditches : new Set(keys);
  const coverage = unchanged ? old!.coverage : new Uint8Array(world.width * world.height);
  if (!unchanged) for (const key of ditches) {
    const x = key % world.width, y = Math.floor(key / world.width);
    for (const [dx, dy] of IRRIGATION_OFFSETS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < world.width && ny < world.height) coverage[ny * world.width + nx] = 1;
    }
  }
  const next = { world, buildings: state.buildings, count: state.buildings.length, width: world.width, height: world.height,
    revision: world.revision, checkedAt: state.time, signature, ditches, coverage };
  caches.set(state, next);
  return next;
}

export function irrigationAt(state: GameState, x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= state.world.width || ty >= state.world.height) return false;
  return prepareIrrigation(state).ditches.has(ty * state.world.width + tx);
}

/** Water benefits nearby farmland irrespective of ownership; overlap never stacks. */
export function irrigationYieldMultiplier(state: GameState, x: number, y: number): 1 | 2 | 3 {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= state.world.width || ty >= state.world.height) return 1;
  if (!prepareIrrigation(state).coverage[ty * state.world.width + tx]) return 1;
  // Double the added benefit: +200% on desert, +100% on other ground.
  return tileAt(state.world, tx, ty)?.terrain === 'desert' ? 3 : 2;
}
