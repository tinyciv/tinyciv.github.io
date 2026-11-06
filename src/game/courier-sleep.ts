import { forbiddenRevision } from './forbidden-zones';
import { decisionRevision } from './decision-schedule';
import { entityStore, type EntityStore } from './entity-store';
import { farmCourierWakeAt } from './farms';
import { farmWorkGroups } from './farm-work-groups';
import { SimulationEvents } from './simulation-events';
import { unitMaxHp, type GameState, type Unit } from './types';

interface Sleeper { camp: number; home?: number; faction: number; x: number; y: number }
interface CourierSleep {
  store: EntityStore;
  sleepers: Map<Unit, Sleeper>;
  camps: Map<number, Set<Unit>>;
  events: SimulationEvents<Unit>;
  reconcile: boolean;
  time: number;
  world: GameState['world'];
  tiles: GameState['world']['tiles'];
  terrain?: number;
  units: number;
  buildings: number;
  fields: GameState['fields'];
  fieldCount: number;
  commands: number;
  zones: GameState['forbiddenZones'];
  zoneRevision: number;
  factions: { id: number; population: number; defeated: boolean; relation: string }[];
}
const schedules = new WeakMap<GameState, CourierSleep>();

function eligible(unit: Unit): boolean {
  return unit.kind === 'worker' && !!unit.collector && !unit.builder && !!unit.inside
    && unit.collectorCamp !== undefined && unit.hp > 0 && unit.hp >= unitMaxHp(unit)
    && unit.order === 'work' && (!unit.collectPhase || unit.collectPhase === 'idle')
    && !unit.cargo && !unit.cargoBatches?.length && !unit.civilianPanic && !unit.routed
    && !unit.training && unit.villageId === undefined && !unit.moving
    && unit.cooldown <= 0 && unit.attackTime <= 0 && !unit.target && !unit.destination
    && !unit.path?.length && !unit.cultivating;
}

function remember(state: GameState, schedule: CourierSleep): void {
  schedule.time = state.time;
  schedule.world = state.world; schedule.tiles = state.world.tiles; schedule.terrain = state.world.revision;
  schedule.units = schedule.store.units.revision; schedule.buildings = schedule.store.buildings.revision;
  schedule.fields = state.fields; schedule.fieldCount = state.fields?.length ?? 0;
  schedule.commands = decisionRevision(state);
  schedule.zones = state.forbiddenZones; schedule.zoneRevision = forbiddenRevision(state);
  schedule.factions = state.factions.map(({ id, population, defeated, relation }) => ({ id, population, defeated, relation }));
}

function changed(state: GameState, schedule: CourierSleep): boolean {
  return state.time < schedule.time || schedule.world !== state.world || schedule.tiles !== state.world.tiles
    || schedule.terrain !== state.world.revision || schedule.units !== schedule.store.units.revision
    || schedule.buildings !== schedule.store.buildings.revision || schedule.fields !== state.fields
    || schedule.fieldCount !== (state.fields?.length ?? 0) || schedule.commands !== decisionRevision(state)
    || schedule.zones !== state.forbiddenZones || schedule.zoneRevision !== forbiddenRevision(state)
    || schedule.factions.length !== state.factions.length || state.factions.some((faction, index) => {
      const old = schedule.factions[index];
      return old.id !== faction.id || old.population !== faction.population || old.defeated !== faction.defeated || old.relation !== faction.relation;
    });
}

/** Restore the existing entity to the ordered active query; no replacement
 * peasant is spawned and cargo, health, claims and identity remain untouched. */
export function wakeCourier(state: GameState, unit: Unit): void {
  const schedule = schedules.get(state), sleeper = schedule?.sleepers.get(unit);
  if (!schedule || !sleeper) return;
  schedule.sleepers.delete(unit); schedule.events.cancel(unit);
  const camp = schedule.camps.get(sleeper.camp);
  camp?.delete(unit); if (!camp?.size) schedule.camps.delete(sleeper.camp);
  schedule.store.setUnitSleeping(unit, false);
}

/** Any plot in a parcel can wake its one assigned gatherer. */
export function wakeFarmCouriers(state: GameState, campId: number): void {
  const schedule = schedules.get(state);
  if (!schedule?.sleepers.size) return;
  const group = farmWorkGroups(state).byCamp.get(campId);
  const camps = group ? group.fields.map(field => field.camp) : [campId];
  for (const camp of camps) {
    const units = schedule.camps.get(camp);
    if (units) for (const unit of units) wakeCourier(state, unit);
  }
}

/** Staffing already visits assignments at 3 Hz. Reconcile those rare edits on
 * the next frame without waking healthy, unchanged workers or scanning plots. */
export function invalidateCourierSleep(state: GameState): void {
  const schedule = schedules.get(state);
  if (schedule) schedule.reconcile = true;
}

/** O(factions + due events) on an unchanged frame; sleeping units and fields
 * are not visited. Runtime state is reconstructed after load or time rewind. */
export function prepareCourierUpdates(state: GameState): void {
  const store = entityStore(state);
  let schedule = schedules.get(state);
  if (!schedule || schedule.store !== store) {
    schedule = { store, sleepers: new Map(), camps: new Map(), events: new SimulationEvents(), reconcile: false,
      time: state.time, world: state.world, tiles: state.world.tiles, units: 0, buildings: 0,
      fields: state.fields, fieldCount: 0, commands: 0, zones: state.forbiddenZones, zoneRevision: 0, factions: [] };
    schedules.set(state, schedule); remember(state, schedule);
  } else if (changed(state, schedule)) {
    for (const unit of schedule.sleepers.keys()) wakeCourier(state, unit);
    remember(state, schedule);
  }
  schedule.time = state.time;
  if (schedule.reconcile) {
    for (const [unit, old] of schedule.sleepers) {
      if (store.units.get(unit.id) !== unit || !eligible(unit) || old.camp !== unit.collectorCamp
        || old.home !== unit.home || old.faction !== unit.faction || old.x !== unit.x || old.y !== unit.y)
        wakeCourier(state, unit);
    }
    schedule.reconcile = false;
  }
  for (const unit of schedule.events.takeDue(state.time)) wakeCourier(state, unit);
}

/** Only a healthy, hidden, empty courier with no work can sleep. Couriers
 * waiting for population capacity while food is ripe stay active, preserving
 * same-frame dispatch order when another peasant returns home. */
export function settleCourier(state: GameState, unit: Unit): void {
  const schedule = schedules.get(state);
  if (!schedule || schedule.sleepers.has(unit) || !eligible(unit)) return;
  const at = farmCourierWakeAt(state, unit);
  if (!(at > state.time)) return;
  const campId = unit.collectorCamp!;
  schedule.sleepers.set(unit, { camp: campId, home: unit.home, faction: unit.faction, x: unit.x, y: unit.y });
  let camp = schedule.camps.get(campId);
  if (!camp) { camp = new Set(); schedule.camps.set(campId, camp); }
  camp.add(unit); schedule.events.schedule(unit, at, unit);
  schedule.store.setUnitSleeping(unit, true);
}
