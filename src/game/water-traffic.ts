import { galleyHullDistance } from './galley-footprint';
import type { FishingBoat } from './fishing';
import type { HarborTradeShip } from './harbor-trade';
import type { GameState, Point, Unit } from './types';

export type Vessel = Unit | FishingBoat | HarborTradeShip;
const SIZE = 3;
const EMPTY_BOATS: readonly FishingBoat[] = [];
export const SMALL_BOAT_RADIUS = .3;
interface Traffic { time: number; units: readonly Unit[]; boats: readonly FishingBoat[]; ships: readonly HarborTradeShip[] | undefined; count: number; buckets: Map<string, Set<Vessel>>; cells: Map<Vessel, string> }
const indexes = new WeakMap<GameState, Traffic>();
const key = (p: Point) => `${Math.floor(p.x / SIZE)},${Math.floor(p.y / SIZE)}`;
const afloat = (v: Vessel) => 'village' in v || v.hp > 0 && ('dock' in v || v.kind === 'sailboat' || !!v.aboardRiverTrade);
function place(index: Traffic, vessel: Vessel): void {
 const next = key(vessel), old = index.cells.get(vessel);
 if (old === next) return;
 if (old) index.buckets.get(old)?.delete(vessel);
 const group = index.buckets.get(next) ?? new Set<Vessel>(); group.add(vessel);
 index.buckets.set(next, group); index.cells.set(vessel, next);
}
function traffic(state: GameState): Traffic {
 const boats = state.fishing?.boats ?? EMPTY_BOATS, previous = indexes.get(state);
 if (previous && previous.time === state.time && previous.units === state.units && previous.boats === boats && previous.ships === state.harborTradeShips
   && previous.count === state.units.length + boats.length) return previous;
 const index: Traffic = {time:state.time, units:state.units, boats, ships:state.harborTradeShips, count:state.units.length + boats.length, buckets:new Map(), cells:new Map()};
 for (const unit of state.units) if (afloat(unit)) place(index, unit);
 for (const boat of boats) if (afloat(boat)) place(index, boat);
 for (const ship of state.harborTradeShips ?? []) place(index, ship);
 indexes.set(state,index); return index;
}
export function refreshWaterTraffic(state: GameState, vessel: Vessel): void { if (afloat(vessel)) place(traffic(state), vessel); }
/** A bounded spatial observation for native Leader hull separation. */
export function nearbyWaterVessels(state: GameState, point: Point, radius: number): Vessel[] {
 const index = traffic(state), vessels: Vessel[] = [];
 for (let y = Math.floor((point.y-radius)/SIZE); y <= Math.floor((point.y+radius)/SIZE); y++)
  for (let x = Math.floor((point.x-radius)/SIZE); x <= Math.floor((point.x+radius)/SIZE); x++)
   for (const vessel of index.buckets.get(`${x},${y}`) ?? [])
    if (afloat(vessel) && Math.hypot(vessel.x-point.x,vessel.y-point.y) <= radius) vessels.push(vessel);
 return vessels;
}
/** One shared spatial index for fishing boats, trade vessels and Leader galleys. */
export function smallBoatTrafficClear(state: GameState, boat: Vessel, point: Point): boolean {
 const index = traffic(state), bx = Math.floor(point.x / SIZE), by = Math.floor(point.y / SIZE);
 for(let y=by-1;y<=by+1;y++)for(let x=bx-1;x<=bx+1;x++)for(const other of index.buckets.get(`${x},${y}`) ?? []) {
  if(other === boat || !afloat(other))continue;
  if('kind' in other && other.kind === 'sailboat') {
   if(galleyHullDistance(other,point) < SMALL_BOAT_RADIUS - 1e-8)return false;
  } else if(Math.hypot(other.x-point.x,other.y-point.y) < 2*SMALL_BOAT_RADIUS - 1e-8)return false;
 }
 return true;
}

/** Bounded local look-ahead; global water routes remain independent of traffic. */
export function smallBoatTrafficSegmentClear(state: GameState, boat: Vessel, from: Point, to: Point): boolean {
 const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / .2));
 for (let step = 1; step <= steps; step++) {
  if (!smallBoatTrafficClear(state, boat, {x:from.x + (to.x-from.x)*step/steps, y:from.y + (to.y-from.y)*step/steps})) return false;
 }
 return true;
}
