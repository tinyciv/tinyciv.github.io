import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { isFarmKind, type Building, type GameState, type Point } from './types';

export interface ClusterOptions {
  excludeCamp?: number;
  /** Footprints being redeveloped cannot anchor the new crop block. */
  vacatedCells?: ReadonlySet<number>;
  /** Earlier destinations in an atomic relocation count as neighboring crops. */
  plannedCells?: ReadonlySet<number>;
}

/** A bounded preference: joining a crop edge matters most; extra neighbors
 * fill holes and corners instead of extending a thin row indefinitely. */
/** Per-cell crop counts for a read-only pass that excludes a different single
 * camp per probe; equivalent to farmCompactnessQuery(state, faction, { excludeCamp }). */
export function farmCompactnessExclusions(state: GameState, faction: number): (camp: { id: number; x: number; y: number; hp: number; faction: number; kind: Building['kind'] }) => (x: number, y: number) => number {
  const { width, height } = state.world, crops = new Map<number, number>();
  for (const building of state.buildings) if (building.hp > 0 && building.faction === faction && isFarmKind(building.kind)) {
    const cell = building.y * width + building.x; crops.set(cell, (crops.get(cell) ?? 0) + 1);
  }
  return camp => {
    const excluded = camp.hp > 0 && camp.faction === faction && isFarmKind(camp.kind) ? camp.y * width + camp.x : -1;
    const cropAt = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= width || y >= height) return 0;
      const cell = y * width + x;
      return Number((crops.get(cell) ?? 0) - Number(cell === excluded) > 0);
    };
    return (x, y) => {
      const cardinal = cropAt(x - 1, y) + cropAt(x + 1, y) + cropAt(x, y - 1) + cropAt(x, y + 1);
      const diagonal = cropAt(x - 1, y - 1) + cropAt(x + 1, y - 1) + cropAt(x - 1, y + 1) + cropAt(x + 1, y + 1);
      return ((cardinal ? 12 + cardinal : 0) + diagonal * .5) / 18;
    };
  };
}

export function farmCompactnessQuery(state: GameState, faction: number, options: ClusterOptions = {}): (x: number, y: number) => number {
  const { width, height } = state.world, crops = new Set(options.plannedCells);
  for (const building of state.buildings) {
    const cell = building.y * width + building.x;
    if (building.hp > 0 && building.faction === faction && isFarmKind(building.kind)
      && building.id !== options.excludeCamp && !options.vacatedCells?.has(cell)) crops.add(cell);
  }
  const cropAt = (x: number, y: number): number => Number(x >= 0 && y >= 0 && x < width && y < height && crops.has(y * width + x));
  return (x, y) => {
    const cardinal = cropAt(x - 1, y) + cropAt(x + 1, y) + cropAt(x, y - 1) + cropAt(x, y + 1);
    const diagonal = cropAt(x - 1, y - 1) + cropAt(x + 1, y - 1) + cropAt(x - 1, y + 1) + cropAt(x + 1, y + 1);
    return ((cardinal ? 12 + cardinal : 0) + diagonal * .5) / 18;
  };
}

/** Marshal the already filtered sites and live or reserved crops to the native parcel planner. */
export function farmParcelPreferenceQuery(state: GameState, palace: Building, sites: readonly Point[], options: ClusterOptions = {}): (x: number, y: number) => number {
  if (!sites.length) return () => 0;
  const { width, height } = state.world;
  const cellOf = (point: Point): number => point.y * width + point.x;
  const owned = new Set(options.plannedCells), foreign: number[] = [];
  for (const building of state.buildings) {
    if (building.hp <= 0 || !isFarmKind(building.kind) || building.id === options.excludeCamp) continue;
    const cell = cellOf(building);
    if (options.vacatedCells?.has(cell)) continue;
    if (building.faction === palace.faction) owned.add(cell);
    else foreign.push(cell);
  }
  const handle = simCore(state).handle, length = sites.length + owned.size + foreign.length;
  const input = rustEngine.sim_farm_parcels_input(handle, length);
  const cells = new Uint32Array(rustEngine.memory.buffer, input, length);
  const indices = new Map<number, number>();
  for (const [index, point] of sites.entries()) {
    const cell = cellOf(point);
    cells[index] = cell;
    indices.set(cell, index);
  }
  let index = sites.length;
  for (const cell of owned) cells[index++] = cell;
  cells.set(foreign, index);
  const output = rustEngine.sim_farm_parcels_plan(handle, width, height, palace.x, palace.y, palace.id, sites.length, owned.size);
  const scores = new Float64Array(rustEngine.memory.buffer, output, sites.length).slice();
  return (x, y) => scores[indices.get(y * width + x) ?? -1] ?? 0;
}

/** Relocation compactness never compensates for more than 1.5 extra walking tiles. */
export const FARM_CLUSTER_WALKING_BIAS = 1.5;
/** A layout preference, not extra crop yield: strong soil/irrigation and delivery advantages still win. */
export const FARM_CLUSTER_PRODUCTION_BONUS = .2;
