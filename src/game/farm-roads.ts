import { entityStore } from './entity-store';
import { isForbidden } from './forbidden-zones';
import { invalidateNavigation, traversable } from './pathfinding';
import { reliefFootprintAllowed } from './relief';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { structureIndex } from './structure-index';
import { WATER, type GameState, type Unit } from './types';
import { removeVillageTrailAt } from './village-trails';
import { markWorldChanged } from './world-revisions';

export function recordFarmRoadCrossing(state: GameState, unit: Unit, x: number, y: number): void {
  if (Math.floor(x) === Math.floor(unit.x) && Math.floor(y) === Math.floor(unit.y)) return;
  rustEngine.sim_farm_road_crossing(simCore(state).handle, state.world.width, state.world.height, unit.faction, x, y, unit.x, unit.y);
}

/** Publish the native candidates together after movement so routing observes
 * a single new structure revision for all roads created this step. */
export function publishFarmRoads(state: GameState): void {
  const handle = simCore(state).handle;
  if (!rustEngine.sim_farm_road_pending(handle)) return;
  const structures = structureIndex(state);
  const pointer = rustEngine.sim_farm_road_candidates(handle);
  const count = new Float64Array(rustEngine.memory.buffer, pointer, 1)[0];
  if (!count) return;
  const candidates = new Float64Array(rustEngine.memory.buffer, pointer + 8, count * 2).slice();
  const { world } = state;
  const hermitCells = new Set<number>();
  for (const hermit of state.hermits ?? []) {
    const size = hermit.status === 'gone' ? 1 : 2;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++)
      hermitCells.add((hermit.y + dy) * world.width + hermit.x + dx);
  }
  const store = entityStore(state), changed: number[] = [];
  let built = false;
  for (let index = 0; index < candidates.length; index += 2) {
    const cell = candidates[index], faction = candidates[index + 1];
    const x = cell % world.width, y = Math.floor(cell / world.width), tile = world.tiles[cell];
    if (!tile || WATER.has(tile.terrain) || tile.farm !== undefined || tile.resource !== undefined || !traversable(world, x, y)
      || hermitCells.has(cell) || isForbidden(state, x, y, faction) || !reliefFootprintAllowed(world, x, y)
      || structures.completesRoadSquare(x, y)) continue;
    store.buildings.add({ id: store.allocateId(), kind: 'road', faction, x, y, hp: 100, maxHp: 100, capacity: 0 });
    built = true;
    const removedTrail = removeVillageTrailAt(world, x, y);
    if (tile.palm || removedTrail) changed.push(cell);
    delete tile.palm;
    delete state.traffic?.[String(cell)];
  }
  if (built) {
    markWorldChanged(world, 'structure', []);
    if (changed.length) markWorldChanged(world, 'appearance', changed);
    invalidateNavigation(state);
  }
}
