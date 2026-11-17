/** Weighted A* and multi-origin travel-map expansion run in WebAssembly. Terrain is copied
 * only when a faction's topology changes; query masks and search storage are
 * reused. Opaque callback blockers keep the exact JavaScript implementation. */
import { rustModule } from './rust-engine';
type KernelExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  configure: (cells: number, width: number) => void;
  edgesOffset: () => number; terrainOffset: () => number; blockedOffset: () => number;
  softOffset: () => number; penaltyOffset: () => number; outputOffset: () => number;
  costsOffset?: () => number;
  landOffset: () => number;
  landOriginsOffset: () => number; landGoalsOffset: () => number;
  preferLandMany: (origins: number, goals: number, size: number) => number;
  indexLand: () => void;
  routeIsGround: (start: number, size: number) => number;
  preferLand: (start: number, size: number, includesStart: number) => number;
  ownersOffset?: () => number;
  search: (start: number, gx: number, gy: number, goalOpen: number, partial: number, cardinal: number, nearest: number) => number;
  searchMany?: (origins: number, minX: number, minY: number, maxX: number, maxY: number) => number;
  travelMap?: (origins: number, speed: number, maxSeconds: number) => void;
  nearestMap?: (origins: number) => void;
};
interface Kernel {
  exports: KernelExports; version: number;
  edges: Uint8Array; terrain: Float64Array; blocked: Uint8Array; soft: Uint8Array; penalty: Float64Array; output: Int32Array;
  costs?: Float64Array;
  land: Uint8Array; landVersion: number; landOrigins: Int32Array; landGoals: Int32Array;
  owners?: Int32Array;
}
let compiled: WebAssembly.Module | undefined = rustModule;
let loading: Promise<boolean> | undefined;
let enabled = true;
const kernels = new WeakMap<object, Kernel>();
const unavailableGrids = new WeakSet<object>();
const diagnostics = { searches: 0, travelMaps: 0, nearestMaps: 0, unsupported: 0, instances: 0, unavailable: 0 };

/** Explicit backend selection also permits honest same-build A/B benchmarks. */
export function setNavigationWasmEnabled(value: boolean): void { enabled = value; }
export function navigationWasmStatus(): { enabled: boolean; ready: boolean; searches: number; travelMaps: number; nearestMaps: number; unsupported: number; instances: number; unavailable: number } {
  return { enabled, ready: !!compiled, ...diagnostics };
}
export async function installNavigationWasm(bytes: BufferSource): Promise<void> {
  compiled = await WebAssembly.compile(bytes);
}

/** Input cells are valid and unique. Copy the result before another native
 * query reuses scratch storage; the first cell is the chosen departure. */
export function wasmPathBetween(grid: { edges: Uint8Array; cost: Float64Array; land?: Uint8Array; landVersion?: number }, version: number, width: number,
  origins: readonly number[], goals: readonly number[]): { cells: Int32Array; cost: number } | null | undefined {
  if (!enabled || !compiled || unavailableGrids.has(grid)) return;
  let kernel: Kernel;
  try { kernel = kernelFor(grid, version, width); }
  catch { unavailableGrids.add(grid); diagnostics.unavailable++; return; }
  if (!kernel.exports.searchMany || !kernel.costs) return;
  kernel.blocked.fill(0);
  let minX = width, minY = grid.edges.length / width, maxX = 0, maxY = 0;
  for (const cell of goals) {
    kernel.blocked[cell] = 1;
    const x = cell % width, y = Math.floor(cell / width);
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  kernel.output.set(origins);
  diagnostics.searches++;
  let count = kernel.exports.searchMany(origins.length, minX, minY, maxX, maxY);
  if (count < 0) return null;
  if (grid.land) {
    kernel.landOrigins.set(origins); kernel.landGoals.set(goals);
    // searchMany uses blocked as its target mask, rather than occupancy.
    kernel.blocked.fill(0);
    count = kernel.exports.preferLandMany(origins.length, goals.length, count);
  }
  const cells = kernel.output.slice(0, count);
  return { cells, cost: kernel.costs[cells[count - 1]] };
}
export function loadNavigationWasm(): Promise<boolean> {
  return loading ??= (async () => {
    try {
      if (compiled) return true;
      const response = await fetch(`${import.meta.env.BASE_URL}wasm/simulation.wasm`);
      if (!response.ok) return false;
      await installNavigationWasm(await response.arrayBuffer());
      return true;
    } catch { return false; } // Navigation remains available if WASM is unavailable.
  })();
}
if (typeof window !== 'undefined' && typeof WebAssembly !== 'undefined') void loadNavigationWasm();

function isIterable(value: unknown): value is Iterable<number> {
  return !!value && typeof (value as Iterable<number>)[Symbol.iterator] === 'function';
}
function kernelFor(grid: { edges: Uint8Array; cost: Float64Array; land?: Uint8Array; landVersion?: number }, version: number, width: number): Kernel {
  let kernel = kernels.get(grid);
  if (!kernel) {
    const exports = new WebAssembly.Instance(compiled!).exports as KernelExports;
    const count = grid.edges.length;
    exports.configure(count, width);
    const buffer = exports.memory.buffer;
    kernel = { exports, version: -1,
      edges: new Uint8Array(buffer, exports.edgesOffset(), count), terrain: new Float64Array(buffer, exports.terrainOffset(), count),
      blocked: new Uint8Array(buffer, exports.blockedOffset(), count), soft: new Uint8Array(buffer, exports.softOffset(), count),
      penalty: new Float64Array(buffer, exports.penaltyOffset(), count), output: new Int32Array(buffer, exports.outputOffset(), count),
      land: new Uint8Array(buffer, exports.landOffset(), count), landVersion: -1,
      landOrigins: new Int32Array(buffer, exports.landOriginsOffset(), count), landGoals: new Int32Array(buffer, exports.landGoalsOffset(), count),
      costs: exports.costsOffset ? new Float64Array(buffer, exports.costsOffset(), count) : undefined,
      owners: exports.ownersOffset ? new Int32Array(buffer, exports.ownersOffset(), count) : undefined };
    kernels.set(grid, kernel); diagnostics.instances++;
  }
  if (kernel.version !== version) {
    kernel.edges.set(grid.edges); kernel.terrain.set(grid.cost);
    if (grid.land && kernel.landVersion !== grid.landVersion) {
      kernel.land.set(grid.land); kernel.exports.indexLand(); kernel.landVersion = grid.landVersion ?? version;
    }
    kernel.version = version;
  }
  return kernel;
}

/** Copy the complete travel field before another route reuses kernel storage.
 * No per-query masks or world arrays need clearing on the JS main thread. */
export function wasmTravelTimeMap(grid: { edges: Uint8Array; cost: Float64Array; land?: Uint8Array; landVersion?: number }, version: number, width: number,
  origins: readonly number[], speed: number, maxSeconds: number): Float32Array | undefined {
  if (!enabled || !compiled || unavailableGrids.has(grid) || !Number.isFinite(speed) || speed <= 0 || Number.isNaN(maxSeconds)) return;
  let kernel: Kernel;
  try { kernel = kernelFor(grid, version, width); }
  catch { unavailableGrids.add(grid); diagnostics.unavailable++; return; }
  if (!kernel.exports.travelMap || !kernel.costs) return;
  kernel.output.set(origins);
  kernel.exports.travelMap(origins.length, speed, maxSeconds);
  diagnostics.travelMaps++;
  return Float32Array.from(kernel.costs);
}

/** One shared field for nearest-city assignment. Source IDs occupy penalty
 * scratch only until this flood finishes; A* clears its penalties as usual. */
export function wasmNearestOriginMap(grid: { edges: Uint8Array; cost: Float64Array; land?: Uint8Array; landVersion?: number }, version: number, width: number,
  origins: ReadonlyMap<number, number>): Int32Array | undefined {
  if (!enabled || !compiled || unavailableGrids.has(grid)) return;
  let kernel: Kernel;
  try { kernel = kernelFor(grid, version, width); }
  catch { unavailableGrids.add(grid); diagnostics.unavailable++; return; }
  if (!kernel.exports.nearestMap || !kernel.owners) return;
  let index = 0;
  for (const [cell, owner] of origins) { kernel.output[index++] = cell; kernel.penalty[cell] = owner; }
  kernel.exports.nearestMap(origins.size);
  diagnostics.nearestMaps++;
  return Int32Array.from(kernel.owners);
}

/** undefined requests the JS fallback; null is an exhausted search. The output
 * view is borrowed until the next query using this grid, and consumed at once. */
export function wasmPath(grid: { edges: Uint8Array; cost: Float64Array; land?: Uint8Array; landVersion?: number }, version: number, width: number, start: number,
  goalX: number, goalY: number, goalOpen: boolean, partial: boolean, cardinal: boolean, nearest: number,
  blockers?: { has: (cell: number) => boolean }, soft?: ReadonlySet<number>, congestion?: ReadonlyMap<number, number>): Int32Array | null | undefined {
  if (!enabled || !compiled) return;
  if (blockers && !isIterable(blockers) || Math.abs(goalX) > 0x100000 || Math.abs(goalY) > 0x100000) { diagnostics.unsupported++; return; }
  if (unavailableGrids.has(grid)) return;
  let kernel: Kernel;
  try { kernel = kernelFor(grid, version, width); }
  catch {
    // A constrained browser may reject this grid's memory allocation. Its
    // existing JS arrays still serve the exact same requests without retries.
    unavailableGrids.add(grid); diagnostics.unavailable++; return;
  }
  kernel.blocked.fill(0); kernel.soft.fill(0); kernel.penalty.fill(0);
  if (blockers) for (const cell of blockers as unknown as Iterable<number>) kernel.blocked[cell] = 1;
  if (soft) for (const cell of soft) kernel.soft[cell] = 1;
  if (congestion) for (const [cell, penalty] of congestion) kernel.penalty[cell] = penalty;
  diagnostics.searches++;
  let size = kernel.exports.search(start, goalX, goalY, +goalOpen, +partial, +cardinal, nearest);
  if (size >= 0 && grid.land) size = kernel.exports.preferLand(start, size, 0);
  return size < 0 ? null : kernel.output.subarray(0, size);
}

/** Native civilian policy also applies to routes from incremental reverse
 * fields and the optional JS search backend. Callback occupancy is sampled
 * lazily from proposed ground routes; each retry adds newly observed blockers. */
export function wasmPreferLandRoute(grid: { edges: Uint8Array; cost: Float64Array; land?: Uint8Array; landVersion?: number },
  version: number, width: number, start: number, route: readonly number[], blockers?: { has: (cell: number) => boolean }): Int32Array | undefined {
  if (!grid.land || !compiled || unavailableGrids.has(grid) || !route.length) return;
  let kernel: Kernel;
  try { kernel = kernelFor(grid, version, width); }
  catch { unavailableGrids.add(grid); diagnostics.unavailable++; return; }
  kernel.blocked.fill(0);
  const opaque = blockers && !isIterable(blockers);
  if (blockers && !opaque) for (const cell of blockers as unknown as Iterable<number>) kernel.blocked[cell] = 1;
  for (;;) {
    kernel.output.set(route);
    const size = kernel.exports.preferLand(start, route.length, 0);
    let changed = false;
    if (opaque) for (let i = 0; i < size; i++) {
      const cell = kernel.output[i];
      if (cell !== start && !kernel.blocked[cell] && blockers.has(cell)) { kernel.blocked[cell] = 1; changed = true; }
    }
    if (!changed) return kernel.output.slice(0, size);
  }
}

/** Cache callers submit a route once; the native mask owns its execution mode. */
export function wasmRouteIsGround(grid: { edges: Uint8Array; cost: Float64Array; land?: Uint8Array; landVersion?: number },
  version: number, width: number, start: number, route: readonly number[]): boolean {
  if (!grid.land || !compiled || unavailableGrids.has(grid) || !route.length) return false;
  const kernel = kernelFor(grid, version, width);
  kernel.output.set(route);
  return !!kernel.exports.routeIsGround(start, route.length);
}

/** The multi-entrance fallback submits its full endpoint sets to the same
 * native rule, rather than locking in whichever entrance favored rowing. */
export function wasmPreferLandBetween(grid: { edges: Uint8Array; cost: Float64Array; land?: Uint8Array; landVersion?: number },
  version: number, width: number, origins: readonly number[], goals: readonly number[], route: readonly number[], cost: number): { cells: Int32Array; cost: number } | undefined {
  if (!grid.land || !compiled || unavailableGrids.has(grid) || !route.length) return;
  const kernel = kernelFor(grid, version, width);
  kernel.blocked.fill(0); kernel.landOrigins.set(origins); kernel.landGoals.set(goals);
  kernel.output.set(route); kernel.costs![route[route.length - 1]] = cost;
  const count = kernel.exports.preferLandMany(origins.length, goals.length, route.length);
  return { cells: kernel.output.slice(0, count), cost: kernel.costs![kernel.output[count - 1]] };
}
