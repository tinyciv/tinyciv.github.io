import { entityStore } from './entity-store';
import { refreshFogUnit } from './fog';
import { unitRespectsForbidden } from './forbidden-zones';
import { garrisonMovementLimits } from './garrison';
import { militiaMovementLimits } from './guard-posts';
import { nativeMovement } from './movement-native';
import { invalidateNavigation, nativeMoveLayers } from './pathfinding';
import { beginUnitFrame, endUnitFrame, refreshIndexedUnit } from './spatial';
import { structureIndex } from './structure-index';
import type { GameState, Unit } from './types';

/** Drain Rust's coalesced obstacle events at the command/update boundary,
 * including while paused. The host transports geometry and mirrors transforms;
 * eligibility, collision checks and destination choice belong to Rust. */
export function displaceNewObstacles(state: GameState): void {
  const cells = structureIndex(state).takeClearance();
  if (!cells.size) return;
  invalidateNavigation(state);
  beginUnitFrame(state);
  const native = nativeMovement(state), store = entityStore(state), temporary: Unit[] = [];
  try {
    // Sleeping couriers also occupy sites. Publish them for this transaction,
    // then remove their temporary movement records after all units move.
    const moved: Unit[] = [];
    for (const unit of state.units) {
      if (!native.resident(unit)) temporary.push(unit);
      const order = store.units.indexOf(unit);
      native.index(unit, order, order, Math.floor(unit.y) * state.world.width + Math.floor(unit.x));
    }
    const footprint = native.mask(cells);
    for (const unit of state.units) {
      const layers = nativeMoveLayers(state, unit.faction, unitRespectsForbidden(state, unit));
      if (!layers) continue;
      const probe = { ...layers, guard: layers.engine.mask(garrisonMovementLimits(state, unit) ?? militiaMovementLimits(state, unit)),
        exemptCurrent: false, plainForbidden: layers.forbidden };
      if (!native.evacuate(unit, probe, footprint)) continue;
      unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
      moved.push(unit);
    }
    for (const unit of moved) {
      refreshIndexedUnit(state, unit);
      refreshFogUnit(state, unit);
    }
  } finally {
    for (const unit of temporary) native.remove(unit);
    endUnitFrame(state);
  }
}
