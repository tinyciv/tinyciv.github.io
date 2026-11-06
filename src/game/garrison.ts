import { territory, type Territory } from './borders';
import { invalidateDecisions } from './decision-schedule';
import { releaseAttackSpot } from './engagement';
import { canWalk, createReachabilityQuery } from './pathfinding';
import { playerFaction } from './player-context';
import { indexedBuilding, indexedLeader } from './spatial';
import { buildingReady, distance, isRetinueMember, type Building, type GameState, type Point, type Unit } from './types';

export const GARRISON_PURSUIT_SECONDS = 5;
export const GARRISON_PURSUIT_TILES = 3;
export interface GarrisonDuty { city: number; post: Point; arrived: boolean; pursuitUntil?: number; returning?: boolean }
interface CityArea { territory: Territory; city: Building; cells: Set<number>; chase: Set<number>; boundary: Set<number>; chaseBoundary: Set<number>; points: Point[]; radius: number }
const areas = new WeakMap<GameState, Map<number, CityArea>>();
const center = (city: Building): Point => ({ x: city.x + 1, y: city.y + 1 });
const cellAt = (state: GameState, point: Point) => Math.floor(point.y) * state.world.width + Math.floor(point.x);
function cities(state: GameState, faction: number): Building[] {
  return state.buildings.filter(city => city.kind === 'palace' && city.faction === faction && buildingReady(city));
}
function nearestCity(list: readonly Building[], point: Point): Building | undefined {
  let best: Building | undefined, gap = Infinity;
  for (const city of list) { const d = distance(center(city), point); if (d < gap || d === gap && city.id < best!.id) { best = city; gap = d; } }
  return best;
}
export function garrisonCityAt(state: GameState, point: Point, faction = playerFaction(state)): Building | undefined {
  const borders = territory(state);
  return borders.owners[cellAt(state, point)] === faction ? nearestCity(cities(state, faction), point) : undefined;
}
function perimeter(cells: ReadonlySet<number>, width: number, height: number): Set<number> {
  const result = new Set<number>();
  for (const cell of cells) {
    const x = cell % width, y = Math.floor(cell / width);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const next = cell + dy * width + dx; if (!cells.has(next)) result.add(next);
    }
  }
  return result;
}
function cityArea(state: GameState, city: Building): CityArea {
  let cache = areas.get(state); if (!cache) { cache = new Map(); areas.set(state, cache); }
  const borders = territory(state), previous = cache.get(city.id);
  if (previous?.territory === borders && previous.city === city) return previous;
  const { width, height } = state.world, list = cities(state, city.faction), cells = new Set<number>(), points: Point[] = [];
  for (let i = 0; i < borders.owners.length; i++) if (borders.owners[i] === city.faction) {
    const point = { x: i % width + .5, y: Math.floor(i / width) + .5 };
    if (nearestCity(list, point)?.id === city.id) { cells.add(i); points.push(point); }
  }
  const chase = new Set(cells);
  for (const cell of cells) {
    const x = cell % width, y = Math.floor(cell / width);
    for (let dy = -GARRISON_PURSUIT_TILES; dy <= GARRISON_PURSUIT_TILES; dy++) for (let dx = -GARRISON_PURSUIT_TILES; dx <= GARRISON_PURSUIT_TILES; dx++) {
      if (dx * dx + dy * dy > GARRISON_PURSUIT_TILES ** 2 || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      chase.add(cell + dy * width + dx);
    }
  }
  const result = { territory: borders, city, cells, chase, boundary: perimeter(cells, width, height), chaseBoundary: perimeter(chase, width, height), points, radius: Math.max(0, ...points.map(point => distance(center(city), point))) };
  cache.set(city.id, result); return result;
}
function home(state: GameState, unit: Unit): Building | undefined {
  const city = indexedBuilding(state, unit.garrison?.city ?? -1);
  return city?.kind === 'palace' && city.faction === unit.faction && buildingReady(city) ? city : undefined;
}
function clearJourney(state: GameState, unit: Unit): void {
  unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined;
  unit.repathAt = 0; unit.stuckFor = 0; unit.moving = false; releaseAttackSpot(state, unit);
}
export function releaseGarrison(state: GameState, faction = playerFaction(state)): number {
  let count = 0;
  for (const unit of state.units) if (unit.faction === faction) {
    delete unit.garrisonCity;
    if (!unit.garrison) continue;
    delete unit.garrison; clearJourney(state, unit); count++;
    unit.joiningRetinue = true; unit.recallIssuedAt = state.time;
    unit.recallReturnOrder = unit.retinueStance === 'hold' ? 'hold' : 'follow';
    if (unit.order === 'flee') unit.routOrder = 'follow'; else unit.order = 'follow';
  }
  invalidateDecisions(state); return count;
}
export function garrisonStatus(state: GameState, faction = playerFaction(state)) {
  const leader = indexedLeader(state, faction), assigned = state.units.filter(unit => unit.faction === faction && unit.hp > 0 && !!unit.garrison);
  const active = assigned.length > 0;
  const city = leader && garrisonCityAt(state, leader, faction);
  const members = state.units.filter(unit => unit.faction === faction && unit.hp > 0 && isRetinueMember(unit)
    && unit.villageId === undefined && unit.fort === undefined && unit.guardPost === undefined && !unit.inside && !unit.training && !unit.routed && unit.order !== 'flee');
  const reason = state.gameOver ? 'The game has ended.' : !leader || leader.hp <= 0 || leader.inside || leader.embarkedOn !== undefined || leader.order === 'flee'
    ? 'Your Leader must be alive, on land, and rallied.' : !active && !city ? 'Enter your city borders to assign a garrison.'
      : !active && !members.length ? 'No active retinue to garrison.' : '';
  return { active, enabled: !reason, reason, city, members, count: assigned.length };
}
export function toggleGarrison(state: GameState): { ok: boolean; message: string } {
  const status = garrisonStatus(state), faction = playerFaction(state);
  if (!status.enabled) return { ok: false, message: status.reason };
  if (status.active) { releaseGarrison(state, faction); return { ok: true, message: 'Garrison recalled to the Leader.' }; }
  const city = status.city!, leader = indexedLeader(state, faction)!, area = cityArea(state, city);
  // Releasing drill is voluntary and must not trigger the low-strength rout.
  if (leader.infantryFormation) leader.infantryFormation.active = false;
  for (const member of state.units) if (member.infantryDrillLeader === leader.id) member.infantryDrillLeader = undefined;
  leader.garrisonCity = city.id;
  const taken = new Set<number>(), origin = center(city);
  for (const [index, unit] of status.members.entries()) {
    const angle = index * Math.PI * (3 - Math.sqrt(5)), radius = Math.min(5, 2.5 + Math.sqrt(index) * .45);
    const preferred = { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
    const points = area.points.filter(point => !taken.has(cellAt(state, point)) && canWalk(state, point.x, point.y, faction))
      .sort((a, b) => distance(a, preferred) - distance(b, preferred));
    const reachable = createReachabilityQuery(state, unit, faction, area.cells.has(cellAt(state, unit)) ? area.boundary : undefined);
    const post = points.find(reachable) ?? { x: unit.x, y: unit.y };
    taken.add(cellAt(state, post)); clearJourney(state, unit);
    unit.garrison = { city: city.id, post, arrived: area.cells.has(cellAt(state, unit)) };
    unit.forcedAttack = undefined; unit.attackReturn = undefined; unit.joiningRetinue = undefined;
    unit.recallIssuedAt = undefined; unit.recallReturnOrder = undefined; unit.order = 'follow';
  }
  invalidateDecisions(state);
  return { ok: true, message: `Retinue defending ${city.cityName ?? 'the settlement'}.` };
}
/** Enforce the same perimeter in path searches, direct moves, and crowd yielding.
 * Recruits outside the city may first walk home; only an active chase opens the
 * three-tile buffer. Returning soldiers cannot reacquire outside targets. */
export function garrisonMovementLimits(state: GameState, unit: Unit): ReadonlySet<number> | undefined {
  const duty = unit.garrison, city = duty && home(state, unit);
  if (!duty || !city || !duty.arrived || unit.order === 'flee') return;
  const area = cityArea(state, city), cell = cellAt(state, unit);
  if (!area.chase.has(cell)) return;
  return !area.cells.has(cell) || duty.pursuitUntil !== undefined && state.time < duty.pursuitUntil && !duty.returning ? area.chaseBoundary : area.boundary;
}
export interface GarrisonOrders {
  yield?: () => boolean;
  enemy: (accept: (target: Unit | Building) => boolean, radius: number) => Unit | Building | undefined;
  fight: (target: Unit | Building) => void;
  move: (point: Point) => void;
}
export function updateGarrison(state: GameState, unit: Unit, orders: GarrisonOrders): boolean {
  const duty = unit.garrison; if (!duty) return false;
  const city = home(state, unit);
  if (!city) {
    delete unit.garrison; clearJourney(state, unit); unit.joiningRetinue = true; unit.order = 'follow';
    invalidateDecisions(state); return false;
  }
  const area = cityArea(state, city), inside = area.cells.has(cellAt(state, unit));
  if (inside) duty.arrived = true;
  if (!inside && duty.pursuitUntil === undefined) duty.returning = true;
  if (duty.pursuitUntil !== undefined && (state.time >= duty.pursuitUntil || !area.chase.has(cellAt(state, unit)))) {
    duty.returning = true; duty.pursuitUntil = undefined; clearJourney(state, unit);
  }
  if (duty.returning && inside) { duty.returning = false; duty.pursuitUntil = undefined; }
  if (!area.cells.has(cellAt(state, duty.post)) || !canWalk(state, duty.post.x, duty.post.y, unit.faction)) {
    const reachable = createReachabilityQuery(state, unit, unit.faction, garrisonMovementLimits(state, unit));
    const replacement = area.points.filter(point => canWalk(state, point.x, point.y, unit.faction))
      .sort((a, b) => distance(a, unit) - distance(b, unit)).find(reachable);
    if (replacement) { duty.post = replacement; clearJourney(state, unit); }
  }
  if (orders.yield?.()) return true;
  if (duty.arrived && !duty.returning) {
    const radius = Math.max(8, distance(center(city), unit) + area.radius);
    const target = orders.enemy(target => {
      const point = 'capacity' in target ? { x: target.x + .5, y: target.y + .5 } : target;
      return area.cells.has(cellAt(state, point)) || unit.target === target.id && area.chase.has(cellAt(state, point))
        && (duty.pursuitUntil === undefined || state.time < duty.pursuitUntil);
    }, radius);
    if (target) {
      if (!area.cells.has(cellAt(state, target))) duty.pursuitUntil ??= state.time + GARRISON_PURSUIT_SECONDS;
      else if (inside) duty.pursuitUntil = undefined;
      orders.fight(target); return true;
    }
  }
  if (unit.target !== undefined) clearJourney(state, unit);
  duty.pursuitUntil = undefined;
  if (!inside) duty.returning = true;
  unit.order = 'follow';
  if (distance(unit, duty.post) > .15) orders.move(duty.post);
  else unit.moving = false;
  return true;
}
