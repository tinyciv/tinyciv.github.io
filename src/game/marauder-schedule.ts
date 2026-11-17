import { humanVisibilityViews, pointInSight, type FogView } from './fog';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import type { GameState, MarauderPack, Unit } from './types';

/** Host bridge to rust/src/sim/marauders.rs. Rust owns the frame counter, the
 * five-frame phases and each clock's pending time; this module supplies the
 * human visibility that wakes a hidden marauder, formation or pack. */
export const HIDDEN_MARAUDER_UPDATE_DIVISOR = 5;
const UNIT_CLOCK = 0, FORMATION_CLOCK = 1, NO_SCHEDULE = 2;
/** Human visibility views, prepared at most once per simulation step. */
const frameViews = new WeakMap<GameState, { views?: FogView[] }>();

/** Only real simulation steps advance this clock. IDs spread work over five
 * phases without consuming randomness or depending on the observing client. */
export function beginMarauderFrame(state: GameState): void {
  rustEngine.sim_marauder_begin(simCore(state).handle, state.time);
  frameViews.set(state, {});
}
export const isScheduledMarauder = (unit: Unit): boolean => unit.faction === -2 && unit.villageId === undefined;
function visible(state: GameState, unit: Unit): boolean {
  if (unit.inside) return false;
  let frame = frameViews.get(state);
  if (!frame) { frame = {}; frameViews.set(state, frame); }
  frame.views ??= humanVisibilityViews(state);
  return frame.views.some(view => pointInSight(view, unit.x, unit.y));
}

/** Zero means skip sensing/planning this step. Movement and morale consume the
 * accumulated elapsed time once, never five replayed AI/pathfinding updates.
 * Cooldowns, already-acquired attacks, projectiles and healing stay fast. */
export function marauderUpdateElapsed(state: GameState, unit: Unit, dt: number): number {
  if (!isScheduledMarauder(unit)) return dt;
  const sim = simCore(state).handle, due = rustEngine.sim_marauder_charge(sim, UNIT_CLOCK, unit.id, dt);
  if (due === NO_SCHEDULE) return dt;
  if (!visible(state, unit) && !due) return 0;
  return rustEngine.sim_marauder_take(sim, UNIT_CLOCK, unit.id);
}

/** Hidden formations are a single moving group. Their leader supplies the
 * phase, avoiding a full formation march on every frame while each member's
 * ordinary AI is already asleep. Seeing any rank wakes the group immediately;
 * existing combat cooldowns and hits still run on the ordinary unit clock. */
export function marauderFormationElapsed(state: GameState, leader: Unit, members: readonly Unit[], dt: number): number {
  if (!isScheduledMarauder(leader)) return dt;
  const sim = simCore(state).handle, due = rustEngine.sim_marauder_charge(sim, FORMATION_CLOCK, leader.id, dt);
  if (due === NO_SCHEDULE) return dt;
  if (!due && !visible(state, leader) && !members.some(unit => unit.hp > 0 && visible(state, unit))) return 0;
  return rustEngine.sim_marauder_take(sim, FORMATION_CLOCK, leader.id);
}

/** Shared pack objectives receive the same reduction when every member is
 * hidden; a visible member wakes the entire pack's strategic planning. */
export function marauderPackUpdateDue(state: GameState, pack: MarauderPack, members: readonly Unit[]): boolean {
  return !!rustEngine.sim_marauder_pack_due(simCore(state).handle, pack.id) || members.some(unit => unit.hp > 0 && visible(state, unit));
}
