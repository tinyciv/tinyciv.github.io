import { civilianCityPopulations, workerHomeCity } from './civilian-population';
import type { GameState, Unit } from './types';
import { unitsWithRole } from './spatial';
import { simulationReadsActive } from './simulation-reads';

interface PeasantFrame { workers: Map<number, Set<Unit>>; factions: Map<Unit, number>; members?: readonly Unit[]; populations?: Map<number, number>; populationKey?: string; }
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
}
export function refreshPeasant(state: GameState, unit: Unit): void {
  const frame = frames.get(state);
  if (!frame) return;
  const previous = frame.factions.get(unit), faction = unit.kind === 'worker' ? unit.faction : undefined;
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
  let active = 0;
  for (const other of workers ?? state.units) {
    if (other.kind === 'worker' && other.faction === unit.faction && other.hp > 0 && !other.inside
      && workerHomeCity(state, other)?.id === city.id && ++active >= population) return false;
  }
  return true;
}
