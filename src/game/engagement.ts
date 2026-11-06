import { CHECK_INTERVAL } from './work-cadence';
import { decisionDue, type DecisionClock } from './decision-schedule';
import { simulationReadsActive } from './simulation-reads';
import { maximumUnitRange, unitAttackRange } from './combat-range';
import TinyQueue from 'tinyqueue';
import { civilianFootprint, unitObstructs, unitBlocksNavigationCell } from './collisions';
import { indexedUnit, unitOccupancy } from './spatial';
import { type Building, type GameState, type Point, type Unit, buildingWidth, buildingHeight, distance, isWallKind } from './types';
import { buildingBlockerView, canMove, canWalk, createReachabilityQuery, isNarrowPassage, type CellBlockers } from './pathfinding';

interface AttackSlot { target: number; point: Point; until: number; reuseUntil?: number; }
interface ExpiringSlot { id: number; slot: AttackSlot }
/** Claims own their cell membership and expiry. Candidate queries only inspect
 * the cells they can actually use; no army-wide reconciliation is needed. */
class AttackReservations {
  readonly slots = new Map<number, AttackSlot>();
  readonly cells = new Map<number, Set<number>>();
  private expiry = new TinyQueue<ExpiringSlot>([], (a, b) => a.slot.until - b.slot.until);
  constructor(private width: number) {}
  private cell(point: Point): number { return Math.floor(point.y) * this.width + Math.floor(point.x); }
  resize(width: number): void {
    if (width === this.width) return;
    this.width = width; this.cells.clear();
    for (const [id, slot] of this.slots) this.addCell(id, slot);
  }
  private addCell(id: number, slot: AttackSlot): void {
    const key = this.cell(slot.point), ids = this.cells.get(key) ?? new Set<number>();
    ids.add(id); this.cells.set(key, ids);
  }
  private removeCell(id: number, slot: AttackSlot): void {
    const key = this.cell(slot.point), ids = this.cells.get(key);
    ids?.delete(id); if (!ids?.size) this.cells.delete(key);
  }
  set(id: number, slot: AttackSlot): void {
    const previous = this.slots.get(id);
    if (previous) this.removeCell(id, previous);
    this.slots.set(id, slot); this.addCell(id, slot); this.expiry.push({ id, slot });
    this.compact();
  }
  delete(id: number): void {
    const previous = this.slots.get(id);
    if (!previous) return;
    this.removeCell(id, previous); this.slots.delete(id); this.compact();
  }
  prune(now: number): void {
    // Reservations are inclusive at their deadline, as in the original scan.
    while (this.expiry.length && this.expiry.peek()!.slot.until < now) {
      const { id, slot } = this.expiry.pop()!;
      if (this.slots.get(id) === slot) this.delete(id);
    }
  }
  private compact(): void {
    if (this.expiry.length > 64 && this.expiry.length > this.slots.size * 2)
      this.expiry = new TinyQueue([...this.slots].map(([id, slot]) => ({ id, slot })), (a, b) => a.slot.until - b.slot.until);
  }
}
const claims = new WeakMap<GameState, AttackReservations>();
const cell = (state: GameState, point: Point): number => Math.floor(point.y) * state.world.width + Math.floor(point.x);
const isBuilding = (target: Unit | Building): target is Building => 'capacity' in target;
const gap = (point: Point, target: Unit | Building): number => isBuilding(target)
  ? Math.hypot(Math.max(target.x - point.x, 0, point.x - target.x - buildingWidth(target)), Math.max(target.y - point.y, 0, point.y - target.y - buildingHeight(target))) : distance(point, target);
function reservations(state: GameState): AttackReservations {
  let result = claims.get(state);
  if (!result) { result = new AttackReservations(state.world.width); claims.set(state, result); }
  result.resize(state.world.width); result.prune(state.time);
  return result;
}
/** Reserve one distinct, physically reachable melee cell per attacker. This is
 * destination assignment, not a full space-time Cooperative A* implementation.
 * Stable slots stop a rear rank repeatedly choosing the same front-rank cell. */
export function attackSpots(state: GameState, unit: Unit, target: Unit | Building, contact: (point: Point) => boolean): Point[] {
  const occupied = unitOccupancy(state, unit), size = isBuilding(target) ? buildingWidth(target) : 0, height = isBuilding(target) ? buildingHeight(target) : 0;
  // Probe exact candidate cells directly. The live tile index avoids collecting
  // and sorting all neighboring units for each possible attack target.
  const range = maximumUnitRange(unit), extent = range + size + 1;
  const reservationsForState = reservations(state), slots = reservationsForState.slots;
  const reserved = (at: number): boolean => {
    for (const id of reservationsForState.cells.get(at) ?? []) {
      const claim = slots.get(id)!;
      if (Math.abs(claim.point.x - target.x) > extent || Math.abs(claim.point.y - target.y) > extent) continue;
      const other = indexedUnit(state, id);
      if (other && unitObstructs(unit, other)) return true;
    }
    return false;
  };
  const blockers = buildingBlockerView(state, unit.faction);
  const spots: Point[] = [];
  for (let y = Math.floor(target.y - range); y <= Math.floor(target.y + height + range); y++) {
    for (let x = Math.floor(target.x - range); x <= Math.floor(target.x + size + range); x++) {
      if (occupied.has(y * state.world.width + x) || reserved(y * state.world.width + x) || !canWalk(state, x, y, unit.faction, blockers)) continue;
      // Cell centers are preferred, with a modest within-cell adjustment when a
      // moving target would otherwise have no legal contact point in this cell.
      let point: Point = { x: x + .5, y: y + .5 };
      if (gap(point, target) > unitAttackRange(state.world, unit, target, point)) point = { x: Math.max(x + .18, Math.min(x + .82, target.x + size / 2)), y: Math.max(y + .18, Math.min(y + .82, target.y + height / 2)) };
      if (gap(point, target) <= unitAttackRange(state.world, unit, target, point) && gap(point, target) >= .35 && contact(point)) spots.push(point);
    }
  }
  if (spots.length < 2) return spots;
  const previous = slots.get(unit.id), previousCell = previous?.target === target.id ? cell(state, previous.point) : -1;
  const penalizeNarrow = isBuilding(target) && !isWallKind(target.kind) && unit.range <= 1.5;
  // Probe each candidate's four passage exits once, rather than repeating the
  // same terrain/building checks during every comparison. Retain the original
  // comparator's arithmetic order and stable row-major ties exactly.
  const ranked = spots.map(point => ({ point, distance: distance(unit, point),
    stable: previousCell === cell(state, point) ? -.7 : 0,
    narrow: penalizeNarrow && isNarrowPassage(state, point, unit.faction) ? 3 : 0 }));
  ranked.sort((a, b) => a.distance + a.stable + a.narrow - b.distance - b.stable - b.narrow);
  for (let i = 0; i < ranked.length; i++) spots[i] = ranked[i].point;
  return spots;
}
const attackSpotClocks = new WeakMap<Unit, DecisionClock>();
export function claimAttackSpot(state: GameState, unit: Unit, target: Unit | Building, contact: (point: Point) => boolean): Point | undefined {
  const occupied = unitOccupancy(state, unit), previous = reservations(state).slots.get(unit.id);
  // Search for a destination at most three times per second. Between samples,
  // validate only the retained destination; movement checks each actual edge.
  let clock = attackSpotClocks.get(unit);
  if (!clock) { clock = {}; attackSpotClocks.set(unit, clock); }
  const retained = (): Point | undefined => previous?.target === target.id && !occupied.has(cell(state, previous.point))
    && canWalk(state, previous.point.x, previous.point.y, unit.faction)
    && gap(previous.point, target) <= unitAttackRange(state.world, unit, target, previous.point)
    && gap(previous.point, target) >= .35 && contact(previous.point) ? previous.point : undefined;
  const trusted = simulationReadsActive(state);
  if (trusted && !decisionDue(clock, state.time, unit.id)) return retained();
  // Standalone movement/editor callers also retain a valid traveling slot,
  // while still reconciling an invalid slot against their directly edited state.
  if (!trusted && previous && state.time < (previous.reuseUntil ?? 0) && unit.path?.length
    && unit.pathGoal && distance(unit.pathGoal, previous.point) < .12) {
    const point = retained();
    if (point) return point;
  }
  const spots = attackSpots(state, unit, target, contact);
  if (!spots.length) return;
  let blockers: CellBlockers | undefined, reachable: ((point: Point) => boolean) | undefined;
  for (const point of spots) {
    const atSpot = distance(unit, point) < .12;
    if (!atSpot && !blockers) {
      const buildings = buildingBlockerView(state, unit.faction);
      blockers = { has: index => buildings.has(index) || occupied.has(index) };
    }
    // Only existence matters here; one resumable connectivity walk answers all
    // candidate goals without allocating and discarding weighted A* paths.
    if (atSpot || canMove(state, unit, point, unit.faction, blockers) || (reachable ??= createReachabilityQuery(state, unit, unit.faction, occupied))(point)) {
      reservations(state).set(unit.id, { target: target.id, point, until: state.time + 1.25, reuseUntil: state.time + CHECK_INTERVAL });
      return point;
    }
  }
  return undefined;
}
export function releaseAttackSpot(state: GameState, unit: Unit): void { claims.get(state)?.delete(unit.id); }

/** A short shared intention horizon lets later A* searches prefer different
 * lanes. Friendly plans are costs, never permanent obstacles: choke points still
 * work and a lower-priority worker can wait for an occupied corridor to clear.
 * The optional read-only visitor builds route blocker classes in this same
 * original-order scan instead of making a second pass over the entire army. */
export function movementCongestion(state: GameState, unit: Unit, visitObstruction?: (other: Unit, cell: number) => void,
  result = new Map<number, number>()): Map<number, number> {
  result.clear();
  // Civilian footprints never obstruct or collide, including with military
  // units. Their route queries need neither army scans nor reservation costs.
  if (civilianFootprint(unit)) return result;
  const add = (index: number, cost: number) => { result.set(index, (result.get(index) ?? 0) + cost); };
  for (const other of state.units) {
    if (!unitBlocksNavigationCell(unit, other)) continue;
    const index = cell(state, other);
    visitObstruction?.(other, index);
    if (other.faction !== unit.faction) continue;
    add(index, other.moving ? 2 : 5);
    const path = other.path;
    if (path) for (let i = 0; i < path.length && i < 3; i++) add(cell(state, path[i]), .8);
  }
  for (const [id, slot] of reservations(state).slots) {
    const other = indexedUnit(state, id);
    if (other && unitBlocksNavigationCell(unit, other)) add(cell(state, slot.point), 3);
  }
  return result;
}
