import { updateFog } from './fog';
import { buildingBlockerView, canMove, scenarioAccessTerrain } from './pathfinding';
import { rustEngine } from './rust-engine';
import { SimSlot, simCore } from './sim-handle';
import { WATER, buildingWidth, buildingHeight, type GameState, type Point, type Unit, type World } from './types';
import { worldRevisions } from './world-revisions';

export const DEER = {
  hp: rustEngine.deer_stat(0), food: rustEngine.deer_stat(1), spookRadius: rustEngine.deer_stat(2),
  restMin: rustEngine.deer_stat(3), restMax: rustEngine.deer_stat(4), strollTime: rustEngine.deer_stat(5),
  strollSpeed: rustEngine.deer_stat(6), fleeSpeed: rustEngine.deer_stat(7),
};

const habitats = new SimSlot<{ world: World; sight: number; capacity: number }>();

/** Refresh the native habitat when admitting a batch, using the existing static
 * navigation layer to exclude solid canopy, rocky ground, and cliffs. */
export function deerHerdCapacity(state: GameState): number {
  const { world } = state, { width, height, tiles } = world;
  const { sight } = worldRevisions(world), previous = habitats.get(state);
  if (previous?.world === world && previous.sight === sight) return previous.capacity;
  const handle = simCore(state).handle;
  const { open, edges } = scenarioAccessTerrain(world);
  const pointer = rustEngine.sim_deer_terrain_input(handle, width, height);
  const input = new Uint8Array(rustEngine.memory.buffer, pointer, tiles.length * 2);
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell];
    input[cell * 2] = Number(!!open[cell] && !WATER.has(tile.terrain) && !tile.marsh && !tile.beach)
      | Number(tile.biome === 'forest') << 1
      | Number(tile.overlay === 'forest' || tile.overlay === 'jungle') << 2;
    input[cell * 2 + 1] = edges[cell];
  }
  return habitats.set(state, { world, sight, capacity: rustEngine.sim_deer_terrain_finish(handle) }).capacity;
}

interface DeerSpawn extends Point { group: number; sex: NonNullable<Unit['deerSex']>; facing: number }

/** Send one exclusion mask for all herds in a batch. Native placement owns
 * habitat ranking, connected spawn groups, herd sizes and sex ratios. */
export function nativeDeerSpawns(state: GameState, groups: number, seed: number): DeerSpawn[] {
  const { world } = state, { width, height, tiles } = world, handle = simCore(state).handle;
  const views = state.multiplayer ? state.multiplayer.humanFactionIds.map(faction => updateFog(state, faction)) : [updateFog(state)];
  const pointer = rustEngine.sim_deer_spawn_input(handle, tiles.length);
  const excluded = new Uint8Array(rustEngine.memory.buffer, pointer, tiles.length);
  for (let cell = 0; cell < tiles.length; cell++)
    excluded[cell] = Number(tiles[cell].farm !== undefined || views.some(view => view.visible[cell]));
  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    const left = Math.max(0, building.x - 3), right = Math.min(width, building.x + buildingWidth(building) + 3);
    for (let y = Math.max(0, building.y - 3); y < Math.min(height, building.y + buildingHeight(building) + 3); y++)
      excluded.fill(1, y * width + left, y * width + right);
  }
  for (const unit of state.units) {
    if (unit.hp <= 0 || unit.inside || unit.x < 0 || unit.x >= width || unit.y < 0 || unit.y >= height) continue;
    const cx = Math.floor(unit.x), cy = Math.floor(unit.y);
    if (unit.faction < 0 && (unit.kind === 'boar' || unit.kind === 'marshBird' || unit.kind === 'deer')) {
      excluded[cy * width + cx] = 1;
      continue;
    }
    // Revealed and hidden factions both count as nearby activity.
    const left = Math.max(0, cx - 7), right = Math.min(width, cx + 8);
    for (let y = Math.max(0, cy - 7); y < Math.min(height, cy + 8); y++)
      excluded.fill(1, y * width + left, y * width + right);
  }
  for (const herd of state.wildlife?.herds ?? []) {
    if (herd.species === 'deer') {
      const home = herd.home ?? herd.waypoint;
      rustEngine.sim_deer_exclude_herd(handle, home.x, home.y);
    }
  }
  const output = rustEngine.sim_deer_spawn(handle, seed, groups);
  const count = new Float64Array(rustEngine.memory.buffer, output, 1)[0];
  const rows = new Float64Array(rustEngine.memory.buffer, output + 8, count * 4);
  return Array.from({ length: count }, (_, i) => {
    const [group, cell, male, facing] = rows.subarray(i * 4, i * 4 + 4);
    return { group, x: cell % width + .5, y: Math.floor(cell / width) + .5, sex: male ? 'male' : 'female', facing };
  });
}

/** Native ecology ranks a small local set; current building and edge access
 * still goes through the simulation's usual movement geometry. */
export function nativeDeerGoal(state: GameState, deer: Unit, home: Point, threat: Point | undefined, seed: number): Point {
  if (!habitats.get(state)) deerHerdCapacity(state);
  const output = rustEngine.sim_deer_waypoints(simCore(state).handle, deer.x, deer.y, home.x, home.y,
    threat?.x ?? deer.x, threat?.y ?? deer.y, Number(!!threat), seed);
  const count = new Float64Array(rustEngine.memory.buffer, output, 1)[0];
  const rows = new Float64Array(rustEngine.memory.buffer, output + 8, count * 2).slice();
  const blockers = buildingBlockerView(state, deer.faction);
  for (let i = 0; i < rows.length; i += 2) {
    const candidate = { x: rows[i], y: rows[i + 1] };
    if (canMove(state, deer, candidate, deer.faction, blockers)) return candidate;
  }
  return { x: deer.x, y: deer.y };
}
