import { decisionRevision } from './decision-schedule';
import { entityStore, type EntityStore } from './entity-store';
import { forbiddenRevision } from './forbidden-zones';
import { idleJobWakeAt } from './settlement-decisions';
import { SimulationEvents } from './simulation-events';
import { structureChangeRevision } from './simulation-reads';
import { unitMaxHp, type GameState, type Unit } from './types';
import { isIdleWorkerSlot, workerHasLiveReference } from './worker-slots';
import { worldRevisions, worldStructureRevision } from './world-revisions';

/** Idle builders sheltered in their towns leave the active update list until
 * their own job clock is due, or until any input that would make that choice
 * urgent changes. Waking happens in the same step the job decision would have
 * run, so their choices and timing are unchanged. */
interface Sleeper { home?: number; faction: number; repathAt: number }
interface BuilderSleep { store: EntityStore; sleepers: Map<Unit, Sleeper>; events: SimulationEvents<Unit>; inputs: readonly unknown[]; time: number }
const schedules = new WeakMap<GameState, BuilderSleep>();

function eligible(unit: Unit): boolean {
  return unit.kind === 'worker' && !!unit.builder && !unit.collector && !!unit.inside && unit.hp > 0 && unit.hp >= unitMaxHp(unit)
    && unit.order === 'work' && (!unit.buildPhase || unit.buildPhase === 'idle') && unit.buildSite === undefined
    && unit.repairSite === undefined && !unit.clearTree && !unit.builderRetiring && !unit.drainageWork && !unit.resourceWork
    && !unit.engineer && unit.embarkedOn === undefined && unit.villageId === undefined && unit.seaInvasion === undefined
    && !unit.cargo && !unit.cargoBatches?.length && !unit.civilianPanic && !unit.routed && unit.training === undefined
    && !unit.garrison && !unit.moving && unit.cooldown <= 0 && unit.attackTime <= 0 && !unit.target && !unit.destination
    && !unit.path?.length;
}

/** The same global inputs an idle job decision treats as urgent. */
function urgencyInputs(state: GameState, store: EntityStore): unknown[] {
  const revisions = state.world.revision === undefined ? undefined : worldRevisions(state.world);
  const inputs: unknown[] = [state.world, state.world.tiles, revisions?.geometry, revisions?.sight, structureChangeRevision(state),
    revisions ? worldStructureRevision(state.world) : undefined, store.buildings.revision, store.units.query('worker'),
    store.units.query('builder'), store.units.query('collector'), decisionRevision(state), state.treeClearings?.length ?? 0,
    forbiddenRevision(state), state.factions.length];
  for (const faction of state.factions) inputs.push(faction.id, faction.population);
  return inputs;
}

function wake(schedule: BuilderSleep, unit: Unit): void {
  schedule.sleepers.delete(unit); schedule.events.cancel(unit);
  schedule.store.setUnitSleeping(unit, false);
}

/** Run every step before the unit phase selects its active units. */
export function prepareBuilderUpdates(state: GameState): void {
  const store = entityStore(state), inputs = urgencyInputs(state, store);
  let schedule = schedules.get(state);
  if (!schedule || schedule.store !== store) {
    schedules.set(state, { store, sleepers: new Map(), events: new SimulationEvents(), inputs, time: state.time });
    return;
  }
  const previous = schedule.inputs, rewound = state.time < schedule.time;
  schedule.inputs = inputs; schedule.time = state.time;
  if (!schedule.sleepers.size) return;
  if (rewound || inputs.length !== previous.length || inputs.some((value, index) => value !== previous[index])) {
    for (const unit of [...schedule.sleepers.keys()]) wake(schedule, unit);
    return;
  }
  for (const [unit, old] of [...schedule.sleepers]) {
    if (store.units.get(unit.id) !== unit) { schedule.sleepers.delete(unit); schedule.events.cancel(unit); continue; }
    if (!eligible(unit) || unit.home !== old.home || unit.faction !== old.faction || (unit.repathAt ?? 0) !== old.repathAt) wake(schedule, unit);
  }
  for (const unit of schedule.events.takeDue(state.time)) if (schedule.sleepers.has(unit)) wake(schedule, unit);
}

/** After a builder's own update: sleep while nothing for it can happen. */
export function settleBuilder(state: GameState, unit: Unit): void {
  if (unit.kind !== 'worker' || !unit.builder) return;
  const store = entityStore(state), schedule = schedules.get(state);
  store.setWorkerDormant(unit, isIdleWorkerSlot(unit) && !workerHasLiveReference(state, unit));
  if (!schedule || schedule.store !== store || schedule.sleepers.has(unit) || !eligible(unit)) return;
  const at = idleJobWakeAt(state, unit);
  if (at === undefined || !(at > state.time)) return;
  schedule.sleepers.set(unit, { home: unit.home, faction: unit.faction, repathAt: unit.repathAt ?? 0 });
  schedule.events.schedule(unit, at, unit);
  schedule.store.setUnitSleeping(unit, true);
}
