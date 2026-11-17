import { civilianCityPopulations, workerHomeCity } from './civilian-population';
import type { GameState, Unit } from './types';
import { unitsWithRole } from './spatial';
import { simulationReadsActive } from './simulation-reads';

interface PeasantFrame {
  workers: Map<number, Set<Unit>>; factions: Map<Unit, number>; members?: readonly Unit[]; populations?: Map<number, number>; populationKey?: string;
  /** Active (dispatched or working) workers per home city, built on first use in a frame
   * and kept current as each unit is refreshed after its own update. */
  activeByCity?: Map<number, number>; activeCity?: Map<Unit, number>;
}
const frames = new WeakMap<GameState, PeasantFrame>();
const retained = new WeakMap<GameState, PeasantFrame>();

/** Membership is stable during most unit updates. Health and hiding remain
 * live: a death or dispatch by another unit never leaves an active-count cache
 * stale. Most cities have fewer total workers than residents and need no scan. */
export function beginPeasantFrame(state: GameState): void {
  let frame = retained.get(state);
  if (!frame) { frame = { workers: new Map(), factions: new Map() }; retained.set(state, frame); }
  const members = unitsWithRole(state, 'worker');
  frames.set(state, frame);
  if (frame.members !== members || !simulationReadsActive(state)) {
    const present = new Set(members);
    for (const [unit, faction] of frame.factions) if (!present.has(unit)) {
      frame.workers.get(faction)?.delete(unit); frame.factions.delete(unit);
    }
    frame.members = members;
    for (const unit of members) refreshPeasant(state, unit);
  }
  frame.populations = undefined; frame.populationKey = undefined;
  frame.activeByCity = undefined; frame.activeCity = undefined;
}
const activeHomeCity = (state: GameState, unit: Unit): number | undefined =>
  unit.kind === 'worker' && unit.hp > 0 && (!unit.inside || unit.resourceWork?.phase === 'working') ? workerHomeCity(state, unit)?.id : undefined;
function countActive(frame: PeasantFrame, unit: Unit, city: number | undefined): void {
  const counts = frame.activeByCity!, previous = frame.activeCity!.get(unit);
  if (previous === city) return;
  if (previous !== undefined) counts.set(previous, counts.get(previous)! - 1);
  if (city === undefined) frame.activeCity!.delete(unit);
  else { counts.set(city, (counts.get(city) ?? 0) + 1); frame.activeCity!.set(unit, city); }
}
function activeByCity(state: GameState, frame: PeasantFrame): Map<number, number> {
  if (!frame.activeByCity) {
    frame.activeByCity = new Map(); frame.activeCity = new Map();
    for (const workers of frame.workers.values()) for (const unit of workers) countActive(frame, unit, activeHomeCity(state, unit));
  }
  return frame.activeByCity;
}
export function refreshPeasant(state: GameState, unit: Unit): void {
  const frame = frames.get(state);
  if (!frame) return;
  const previous = frame.factions.get(unit), faction = unit.kind === 'worker' ? unit.faction : undefined;
  if (frame.activeByCity && (faction !== undefined || frame.activeCity!.has(unit))) countActive(frame, unit, activeHomeCity(state, unit));
  if (previous === faction) return;
  if (previous !== undefined) frame.workers.get(previous)?.delete(unit);
  if (faction === undefined) frame.factions.delete(unit);
  else {
    let workers = frame.workers.get(faction);
    if (!workers) { workers = new Set(); frame.workers.set(faction, workers); }
    workers.add(unit); frame.factions.set(unit, faction);
  }
}
export function endPeasantFrame(state: GameState): void { frames.delete(state); }

/** Couriers and construction/repair workers share the population on the map. */
export function canDispatchPeasant(state: GameState, unit: Unit): boolean {
  if (!unit.inside) return true;
  const frame = frames.get(state), city = workerHomeCity(state, unit);
  if (!city) return false;
  const key = state.factions.map(faction => `${faction.id}:${faction.population}`).join(',');
  if (frame && (!frame.populations || frame.populationKey !== key)) {
    frame.populations = civilianCityPopulations(state); frame.populationKey = key;
  }
  const population = (frame?.populations ?? civilianCityPopulations(state)).get(city.id) ?? 0;
  if (population <= 0) return false;
  const workers = frame?.workers.get(unit.faction);
  if (workers && workers.size - Number(workers.has(unit)) < population) return true;
  if (frame && simulationReadsActive(state)) return (activeByCity(state, frame).get(city.id) ?? 0) < population;
  let active = 0;
  for (const other of workers ?? state.units) {
    if (other.kind === 'worker' && other.faction === unit.faction && other.hp > 0
      && (!other.inside || other.resourceWork?.phase === 'working')
      && workerHomeCity(state, other)?.id === city.id && ++active >= population) return false;
  }
  return true;
}

/** A read-only pass over many workers (such as drainage staffing) shares one
 * count of active workers per city; answers equal canDispatchPeasant outside a
 * unit frame. The state must not change while the query is in use. */
export function peasantDispatchQuery(state: GameState): (unit: Unit) => boolean {
  if (frames.has(state)) return unit => canDispatchPeasant(state, unit);
  let populations: Map<number, number> | undefined, active: Map<number, number> | undefined;
  return unit => {
    if (!unit.inside) return true;
    const city = workerHomeCity(state, unit);
    if (!city) return false;
    const population = (populations ??= civilianCityPopulations(state)).get(city.id) ?? 0;
    if (population <= 0) return false;
    if (!active) {
      active = new Map();
      for (const other of state.units) {
        const home = activeHomeCity(state, other);
        if (home !== undefined) active.set(home, (active.get(home) ?? 0) + 1);
      }
    }
    return (active.get(city.id) ?? 0) < population;
  };
}
