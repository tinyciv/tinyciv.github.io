import { canTraverseEdge } from './pathfinding';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { isBuildable, type CampPlanningOptions } from './warcamp-planner';
import type { GameState, Point } from './types';

export const campPopulation = (realms: number): number => rustEngine.camp_population(realms);
export const campNextSize = (large: number, small: number, unavailable: number): number =>
  rustEngine.camp_next_size(large, small, unavailable);
export const campCapacity = (compact: boolean, supply: number): number => rustEngine.camp_capacity(Number(compact), supply);
export const campParty = (compact: boolean, supply: number, wanted: number): number => rustEngine.camp_party(Number(compact), supply, wanted);
export const campTravelLimit = (): number => rustEngine.camp_travel_limit();

function writePoints(handle: number, points: readonly Point[]): void {
  const pointer = rustEngine.sim_camp_sites_points(handle, points.length);
  const rows = new Float32Array(rustEngine.memory.buffer, pointer, points.length * 2);
  points.forEach(({ x, y }, index) => { rows[index * 2] = x; rows[index * 2 + 1] = y; });
}

export function prepareCampSites(state: GameState, starts: readonly Point[], access: readonly Float32Array[]): Uint8Array {
  const { width, height } = state.world, handle = simCore(state).handle, cells = width * height;
  const pointer = rustEngine.sim_camp_sites_input(handle, cells, access.length);
  const travel = new Float32Array(rustEngine.memory.buffer, pointer, cells * access.length);
  access.forEach((map, index) => travel.set(map, index * cells));
  writePoints(handle, starts);
  const clearance = rustEngine.sim_camp_sites_prepare(handle, width, height, access.length);
  return new Uint8Array(rustEngine.memory.buffer, clearance, cells).slice();
}

export function orderedCampSites(state: GameState, gates: readonly Point[]): { realm: number; sites: Uint32Array }[] {
  const { width, height } = state.world, handle = simCore(state).handle;
  writePoints(handle, gates);
  const pointer = rustEngine.sim_camp_sites_order(handle, width, height);
  const rows = new Uint32Array(rustEngine.memory.buffer, pointer, rustEngine.sim_camp_sites_length(handle)).slice();
  const groups: { realm: number; sites: Uint32Array }[] = [];
  for (let index = 0; index < rows.length;) {
    const count = rows[index++];
    const realm = rows[index++];
    groups.push({ realm, sites: rows.subarray(index, index += count) });
  }
  return groups;
}

const LOCAL_SIZE = 9;
const DIRECTIONS = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;
export function planCompactCamp(state: GameState, anchor: Point, seed: number, options: CampPlanningOptions) {
  const { world } = state, handle = simCore(state).handle;
  const origin = { x: anchor.x - 4, y: anchor.y - 4 };
  const point = (cell: number): Point => ({ x: origin.x + cell % LOCAL_SIZE, y: origin.y + Math.floor(cell / LOCAL_SIZE) });
  const facts = new Uint8Array(LOCAL_SIZE ** 2);
  for (let i = 0; i < facts.length; i++) {
    const from = point(i);
    if (!isBuildable(world, from.x, from.y, options)) continue;
    facts[i] = 1 | Number(Number.isFinite(options.access?.[from.y * world.width + from.x])) << 1;
    for (const [index, [dx, dy]] of DIRECTIONS.entries()) {
      if (canTraverseEdge(world, from, { x: from.x + dx, y: from.y + dy })) facts[i] |= 1 << (index + 2);
    }
  }
  const input = rustEngine.sim_camp_compact_input(handle);
  new Uint8Array(rustEngine.memory.buffer, input, facts.length).set(facts);
  const pointer = rustEngine.sim_camp_compact(handle, seed);
  const count = rustEngine.sim_camp_sites_length(handle);
  if (count === 0) return;
  const [gate, tower, firstTent, secondTent, thirdTent, ...paths] =
    Array.from(new Uint32Array(rustEngine.memory.buffer, pointer, count), point);
  const tents = [firstTent, secondTent, thirdTent], footprint = [tower, ...tents, ...paths];
  const x = Math.min(...footprint.map(p => p.x)), y = Math.min(...footprint.map(p => p.y));
  const bounds = {
    x, y, width: Math.max(...footprint.map(p => p.x)) - x + 1,
    height: Math.max(...footprint.map(p => p.y)) - y + 1,
  };
  return { bounds, layout: { gate, refuge: paths[1], towers: [{ ...tower, core: true }], tents, paths, walls: [], signs: [], lair: undefined } };
}
