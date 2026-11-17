import { entityStore } from './entity-store';
import { farmWorkGroups } from './farm-work-groups';
import { parcelHarvest } from './farm-parcels';
import type { GameState, Unit } from './types';

export const FARM_CITY_MIN_TRIP_LIMIT = 4;
export const FARM_DISPATCH_INTERVAL = .3;
export const FARM_DISPATCH_CHECK_SECONDS = 1;
interface CityQueue { active: Set<Unit>; waiting: Unit[]; nextAt: number; jobs: number; limit: number }
interface Dispatch {
  store: ReturnType<typeof entityStore>; roster: readonly Unit[]; groups: ReturnType<typeof farmWorkGroups>;
  time: number; nextCheckAt: number; cities: Map<number, CityQueue>;
}
const schedules = new WeakMap<GameState, Dispatch>();
const waitingUntil = new WeakMap<Unit, number>();

function dispatch(state: GameState): Dispatch {
  const store = entityStore(state), roster = store.units.query('collector'), groups = farmWorkGroups(state);
  const old = schedules.get(state);
  if (old && old.store === store && old.roster === roster && old.groups === groups
    && state.time >= old.time && state.time + 1e-7 < old.nextCheckAt) return old;
  const cities = new Map<number, CityQueue>();
  const priorities = new Map<Unit, ReturnType<typeof parcelHarvest>>();
  for (const unit of roster) {
    if (unit.hp <= 0 || unit.builder || unit.home === undefined) continue;
    let city = cities.get(unit.home);
    if (!city) {
      city = { active: new Set(), waiting: [], jobs: 0, limit: FARM_CITY_MIN_TRIP_LIMIT,
        nextAt: old && state.time >= old.time ? old.cities.get(unit.home)?.nextAt ?? state.time : state.time };
      cities.set(unit.home, city);
    }
    city.jobs++;
    if (!unit.inside) { city.active.add(unit); continue; }
    if (unit.civilianPanic || unit.routed || state.time < (unit.repathAt ?? 0)) continue;
    const group = groups.byCamp.get(unit.collectorCamp!);
    if (!group || group.faction !== unit.faction) continue;
    const harvest = parcelHarvest(state, group);
    if (harvest.food > 0 || harvest.fallow) { city.waiting.push(unit); priorities.set(unit, harvest); }
  }
  for (const city of cities.values()) {
    // A quarter of assigned gatherers may travel together. Four slots serve
    // small cities; the same duty ratio keeps large towns from starving behind
    // a fixed four-worker bottleneck as their farmland expands.
    city.limit = Math.max(FARM_CITY_MIN_TRIP_LIMIT, Math.ceil(city.jobs / 4));
    city.waiting.sort((a, b) => {
      const left = priorities.get(a)!;
      const right = priorities.get(b)!;
      return Number(right.food > 0) - Number(left.food > 0) || left.expiresAt - right.expiresAt
        || left.lastVisitedAt - right.lastVisitedAt || a.id - b.id;
    });
  }
  const schedule = { store, roster, groups, time: state.time, nextCheckAt: state.time + FARM_DISPATCH_CHECK_SECONDS, cities };
  schedules.set(state, schedule);
  return schedule;
}

/** A single shared 1 Hz census and ordered queue replace per-worker crowd
 * scans. No route is planned until the worker owns the next departure slot. */
export function canDepartFarm(state: GameState, unit: Unit): boolean {
  const city = dispatch(state).cities.get(unit.home!);
  if (city && city.active.size < city.limit && city.waiting[0] === unit && state.time + 1e-7 >= city.nextAt) return true;
  waitingUntil.set(unit, state.time + FARM_DISPATCH_CHECK_SECONDS);
  return false;
}

export function departFarm(state: GameState, unit: Unit): void {
  const city = schedules.get(state)?.cities.get(unit.home!);
  if (city) {
    if (city.waiting[0] === unit) city.waiting.shift();
    city.active.add(unit); city.nextAt = state.time + FARM_DISPATCH_INTERVAL;
  }
  waitingUntil.delete(unit);
}

/** Return/death/retirement releases its slot immediately. Failed searches
 * leave the queue too, so an inaccessible field cannot starve its neighbors. */
export function finishFarmTrip(state: GameState, unit: Unit): void {
  for (const city of schedules.get(state)?.cities.values() ?? []) {
    city.active.delete(unit);
    const index = city.waiting.indexOf(unit);
    if (index >= 0) city.waiting.splice(index, 1);
  }
  waitingUntil.delete(unit);
}

export function farmDispatchWakeAt(state: GameState, unit: Unit): number {
  return Math.max(state.time, waitingUntil.get(unit) ?? state.time, unit.repathAt ?? 0);
}

export function invalidateFarmDispatch(state: GameState): void {
  const schedule = schedules.get(state);
  if (schedule) schedule.nextCheckAt = state.time;
}

export function farmDispatchStats(state: GameState): { limit: number; active: number; waiting: number } {
  let active = 0, waiting = 0, limit = 0;
  for (const city of schedules.get(state)?.cities.values() ?? []) { active += city.active.size; waiting += city.waiting.length; limit += city.limit; }
  return { limit, active, waiting };
}
