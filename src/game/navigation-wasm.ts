/** The hot weighted A* expansion loop runs in WebAssembly. Terrain is copied
 * only when a faction's topology changes; query masks and search storage are
 * reused. Opaque callback blockers keep the exact JavaScript implementation. */
interface KernelExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  configure: (cells: number, width: number) => void;
  edgesOffset: () => number; terrainOffset: () => number; blockedOffset: () => number;
  softOffset: () => number; penaltyOffset: () => number; outputOffset: () => number;
  search: (start: number, gx: number, gy: number, goalOpen: number, partial: number, cardinal: number, nearest: number) => number;
}
interface Kernel {
  exports: KernelExports; version: number;
  edges: Uint8Array; terrain: Float64Array; blocked: Uint8Array; soft: Uint8Array; penalty: Float64Array; output: Int32Array;
}
let compiled: WebAssembly.Module | undefined;
let loading: Promise<boolean> | undefined;
let enabled = true;
const kernels = new WeakMap<object, Kernel>();
const unavailableGrids = new WeakSet<object>();
const diagnostics = { searches: 0, unsupported: 0, instances: 0, unavailable: 0 };

/** Explicit backend selection also permits honest same-build A/B benchmarks. */
export function setNavigationWasmEnabled(value: boolean): void { enabled = value; }
export function navigationWasmStatus(): { enabled: boolean; ready: boolean; searches: number; unsupported: number; instances: number; unavailable: number } {
  return { enabled, ready: !!compiled, ...diagnostics };
}
export async function installNavigationWasm(bytes: BufferSource): Promise<void> {
  compiled = await WebAssembly.compile(bytes);
}
export function loadNavigationWasm(): Promise<boolean> {
  return loading ??= (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}wasm/navigation.wasm`);
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
function kernelFor(grid: { edges: Uint8Array; cost: Float64Array }, version: number, width: number): Kernel {
  let kernel = kernels.get(grid);
  if (!kernel) {
    const exports = new WebAssembly.Instance(compiled!).exports as KernelExports;
    const count = grid.edges.length;
    exports.configure(count, width);
    const buffer = exports.memory.buffer;
    kernel = { exports, version: -1,
      edges: new Uint8Array(buffer, exports.edgesOffset(), count), terrain: new Float64Array(buffer, exports.terrainOffset(), count),
      blocked: new Uint8Array(buffer, exports.blockedOffset(), count), soft: new Uint8Array(buffer, exports.softOffset(), count),
      penalty: new Float64Array(buffer, exports.penaltyOffset(), count), output: new Int32Array(buffer, exports.outputOffset(), count) };
    kernels.set(grid, kernel); diagnostics.instances++;
  }
  if (kernel.version !== version) {
    kernel.edges.set(grid.edges); kernel.terrain.set(grid.cost); kernel.version = version;
  }
  return kernel;
}

/** undefined requests the JS fallback; null is an exhausted search. The output
 * view is borrowed until the next query using this grid, and consumed at once. */
export function wasmPath(grid: { edges: Uint8Array; cost: Float64Array }, version: number, width: number, start: number,
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
  const size = kernel.exports.search(start, goalX, goalY, +goalOpen, +partial, +cardinal, nearest);
  return size < 0 ? null : kernel.output.subarray(0, size);
}
