import { cannonRearGoals } from './field-cannon-formation';
import { cancelOffensive } from './offensive-native';
import { whalingMovementSpeed } from './fishing';
import { rustEngine } from './rust-engine';
import { UNIT_KIND_CODES } from './entity-store';
import { militaryFormationCode, militaryFormationType, type MilitaryFormationType } from './military-academy';
import { simulationReadsActive } from './simulation-reads';
import { announceArmyMobilization } from './army-warnings';
import { decisionDue, type DecisionClock } from './decision-schedule';
import { CHECK_INTERVAL } from './work-cadence';
import { marauderFormationElapsed } from './marauder-schedule';
import { buildingBlockerView, canMove, canWalk, findPath } from './pathfinding';
import { playerFaction } from './player-context';
import { isInfantryDrillUnlocked } from './research';
import { entityStore } from './entity-store';
import { requestMovementPath } from './movement-path-schedule';
import { beginBattleRout } from './battle-morale';
import { distance, isSoldier, type GameState, type InputState, type Point, type Unit } from './types';

export const INFANTRY_FORMATION_SPEED = .7 * 1.5;
export const INFANTRY_CATCHUP_MULTIPLIER = 1.25;
export const INFANTRY_SPACING = .72;
export const INFANTRY_FORMATION_MIN_REMAINING = 5;
export const INFANTRY_FORMATION_MIN_START = INFANTRY_FORMATION_MIN_REMAINING;
const BODY_RADIUS = .17, SETTLED_DISTANCE = .008;
const copy = (point: Point): Point => ({ x: point.x, y: point.y });
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
export interface InfantryFormationState {
  type?: MilitaryFormationType; active: boolean; heading: number; manualFacing?: boolean; lastTurnAt?: number; mode: 'rectangle' | 'column'; modeSince: number;
  slots: { id: number; x: number; y: number }[];
  spine: Point[]; lengths: number[]; progress: number; goalDistance: number; goal?: Point;
  history: Point[]; slow: boolean;
}
interface Runtime {
  world: GameState['world']; keyboard: boolean; keyboardPlanAt: number; keyboardHeading: number;
  keyboardX: number; keyboardY: number; goals: Map<number, Point>;
  routes: Map<number, { path: Point[]; target: Point; retryAt: number }>;
  adjusted: Set<number>; temporary: Map<number, Point>;
  searchBudgets: Map<number, { until: number; remaining: number }>;
  validatedSlots?: InfantryFormationState['slots'];
  validatedType?: MilitaryFormationType;
  validatedRoles?: Map<number, Unit['kind']>;
  planning: DecisionClock; members: Unit[]; byId: Map<number, Unit>; speed: number; outer: number;
}
const strengthClocks = new WeakMap<GameState, DecisionClock>();
const runtimes = new WeakMap<Unit, Runtime>();
export type InfantryMove = (unit: Unit, goal: Point, speed: number, dt: number) => void;
function runtime(state: GameState, leader: Unit): Runtime {
  let value = runtimes.get(leader);
  if (!value || value.world !== state.world) {
    value = { world: state.world, keyboard: false, keyboardPlanAt: 0, keyboardHeading: leader.facing,
      keyboardX: 0, keyboardY: 0, planning: {}, members: [], byId: new Map(), speed: leader.speed, outer: 1, goals: new Map(), routes: new Map(), adjusted: new Set(), temporary: new Map(), searchBudgets: new Map() };
    runtimes.set(leader, value);
  }
  return value;
}
const leaderFor = (state: GameState, faction: number): Unit | undefined =>
  entityStore(state).units.query('leader').find(unit => unit.faction === faction && unit.hp > 0);
function available(leader: Unit): boolean { return leader.hp > 0 && !leader.inside && leader.embarkedOn === undefined && leader.boardingBoat === undefined && leader.order !== 'flee'; }
const eligible = (unit: Unit, leader: Unit): boolean => unit.faction === leader.faction && isSoldier(unit) && unit.hp > 0
  && unit !== leader
  && !unit.inside && !unit.training && !unit.routed && unit.order !== 'flee' && unit.embarkedOn === undefined && unit.boardingBoat === undefined
  && !unit.garrison && unit.fort === undefined && unit.guardPost === undefined && unit.villageId === undefined
  && (leader.marauderLeader ? unit.marauderPack === leader.marauderPack && !unit.marauderLeader : unit.marauderPack === undefined)
  && (!unit.joiningRetinue || distance(unit, leader) <= 10);

export function infantryFormationSoldierCount(state: GameState, faction = playerFaction(state)): number {
  const leader = leaderFor(state, faction);
  return leader ? state.units.filter(unit => eligible(unit, leader)).length : 0;
}

/** Death sites call this before the next attack can use formation benefits.
 * Normal updates also catch removals, routing, and other eligibility changes. */
export function enforceInfantryFormationStrength(state: GameState, faction?: number): boolean {
  let collapsed = false;
  for (const leader of state.units) {
    if (leader.kind !== 'leader' && !leader.marauderLeader || !leader.infantryFormation?.active || !available(leader)
      || faction !== undefined && leader.faction !== faction) continue;
    const members = state.units.filter(unit => eligible(unit, leader));
    if (members.length >= INFANTRY_FORMATION_MIN_REMAINING) continue;
    const participants = new Set([...members.map(unit => unit.id), ...leader.infantryFormation.slots.map(slot => slot.id)]);
    const form = leader.infantryFormation;
    form.active = false; form.goal = undefined; form.slots = []; form.spine = []; form.lengths = [];
    runtimes.delete(leader);
    for (const unit of state.units) {
      const member = unit === leader || unit.infantryDrillLeader === leader.id || participants.has(unit.id);
      if (unit.infantryDrillLeader === leader.id) unit.infantryDrillLeader = undefined;
      if (!member || unit.faction !== leader.faction || unit.hp <= 0) continue;
      unit.morale = 0; unit.forcedAttack = undefined; unit.attackReturn = undefined; unit.moving = false;
      beginBattleRout(state, unit);
    }
    collapsed = true;
  }
  return collapsed;
}

export function infantryFormationActive(state: GameState, faction = playerFaction(state)): boolean {
  const leader = leaderFor(state, faction);
  return !!leader?.infantryFormation?.active && available(leader)
    && isInfantryDrillUnlocked(state.factions.find(candidate => candidate.id === faction));
}
export function toggleInfantryFormation(state: GameState): { ok: boolean; message?: string } {
  const faction = playerFaction(state), leader = leaderFor(state, faction);
  if (!leader) return { ok: false, message: 'Your Leader must be alive and on land.' };
  if (leader.infantryFormation?.active) {
    leader.infantryFormation.active = false;
    for (const unit of state.units) if (unit.infantryDrillLeader === leader.id) unit.infantryDrillLeader = undefined;
    return { ok: true, message: 'Formation released.' };
  }
  if (!isInfantryDrillUnlocked(state.factions.find(candidate => candidate.id === faction))) return { ok: false, message: 'Research Infantry Drill first.' };
  if (!available(leader)) return { ok: false, message: leader.order === 'flee' ? 'Wait for your Leader to rally before forming ranks.'
    : leader.boardingBoat !== undefined ? 'Finish or cancel boarding before forming ranks.' : 'Bring your Leader ashore before forming ranks.' };
  const soldiers = infantryFormationSoldierCount(state, faction);
  if (soldiers < INFANTRY_FORMATION_MIN_START)
    return { ok: false, message: `Formation needs ${INFANTRY_FORMATION_MIN_START} available soldiers on land (${soldiers}/${INFANTRY_FORMATION_MIN_START}). Training, routed and garrisoned troops cannot form ranks.` };
  cancelOffensive(state, faction);
  leader.infantryFormation = { type: militaryFormationType(state, faction), active: true, heading: leader.facing, mode: 'rectangle', modeSince: state.time,
    slots: [], spine: [], lengths: [], progress: 0, goalDistance: 0, history: [copy(leader)], slow: false };
  runtimes.delete(leader);
  for (const unit of state.units) if (unit === leader || eligible(unit, leader)) {
    unit.target = undefined; unit.forcedAttack = undefined; unit.attackReturn = undefined;
    unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
    unit.infantryDrillLeader = leader.id;
  }
  announceArmyMobilization(state, leader, 'formation');
  return { ok: true, message: 'Forming ranks around the Leader.' };
}
/** Read the native formation's local offsets from the Leader. */
export function infantryRectangleOffsets(count: number, type: MilitaryFormationType = 'standard'): Point[] {
  count = Math.max(0, Math.floor(count));
  const code = militaryFormationCode(type);
  return Array.from({ length: count }, (_, index) => ({
    x: rustEngine.infantry_formation_offset(count, code, index, 0),
    y: rustEngine.infantry_formation_offset(count, code, index, 1),
  }));
}
function synchronizeSlots(state: GameState, formation: InfantryFormationState, members: Unit[], rt: Runtime): void {
  if (rt.validatedType === formation.type && rt.validatedSlots === formation.slots && formation.slots.length === members.length
    && members.every(unit => rt.validatedRoles?.get(unit.id) === unit.kind)) return;
  const byId = new Map(members.map(unit => [unit.id, unit]));
  const role = (unit: Unit): 'levy' | 'ranged' | 'melee' => unit.kind === 'levyInfantry' ? 'levy' : unit.kind === 'archer' || unit.range > 1.5 ? 'ranged' : 'melee';
  const offsets = infantryRectangleOffsets(members.length, formation.type);
  // Local +x is forward and y is lateral. The least protected troops occupy
  // the outer wings; ranged regulars take the rear among the remaining cells.
  const levyCount = members.filter(unit => role(unit) === 'levy').length;
  const wings = new Set(offsets.slice().sort((a, b) => Math.abs(b.y) - Math.abs(a.y) || b.x - a.x || a.y - b.y).slice(0, levyCount));
  const rangedCount = members.filter(unit => role(unit) === 'ranged').length;
  const rear = new Set(offsets.filter(offset => !wings.has(offset)).sort((a, b) => a.x - b.x || Math.abs(a.y) - Math.abs(b.y) || a.y - b.y).slice(0, rangedCount));
  const slotRole = (offset: Point) => wings.has(offset) ? 'levy' : rear.has(offset) ? 'ranged' : 'melee';
  const offsetKey = (point: Point): string => `${point.x}:${point.y}`;
  const offsetsByPosition = new Map(offsets.map(offset => [offsetKey(offset), offset]));
  const valid = rt.validatedType === formation.type && formation.slots.length === members.length && formation.slots.every(slot => {
    const member = byId.get(slot.id), offset = offsetsByPosition.get(offsetKey(slot));
    return !!member && !!offset && role(member) === slotRole(offset);
  });
  if (valid) { rt.validatedSlots = formation.slots; rt.validatedRoles = new Map(members.map(unit => [unit.id, unit.kind])); return; }
  const oldByPosition = new Map(formation.slots.map(slot => [offsetKey(slot), slot]));
  const retained = new Set<number>();
  const slots = offsets.map(offset => {
    const old = oldByPosition.get(offsetKey(offset));
    const member = old && byId.get(old.id);
    if (!old || !member || retained.has(member.id) || role(member) !== slotRole(offset)) return { id: -1, ...offset };
    retained.add(member.id);
    return old;
  });
  const remaining = { levy: [] as number[], ranged: [] as number[], melee: [] as number[] };
  for (const unit of members.slice().sort((a, b) => b.id - a.id))
    if (!retained.has(unit.id)) remaining[role(unit)].push(unit.id);
  for (let index = 0; index < slots.length; index++) if (slots[index].id < 0) {
    slots[index].id = remaining[slotRole(offsets[index])].pop()!;
  }
  const artilleryRear = cannonRearGoals(state, members, new Map(slots.map(slot => [slot.id, { x: slot.x, y: slot.y }])), { x: 0, y: 0 }, 0);
  formation.slots = slots.map(slot => ({ id: slot.id, ...artilleryRear.get(slot.id)! })); rt.validatedType = formation.type; rt.validatedSlots = formation.slots; rt.validatedRoles = new Map(members.map(unit => [unit.id, unit.kind]));
}

/** The game permits diagonal point navigation at touching tile corners. Close
 * ranks additionally keep a small physical body clear of those corner gaps. */
export function infantryPointClear(state: GameState, point: Point, faction: number): boolean {
  const blockers = buildingBlockerView(state, faction);
  for (let y = Math.floor(point.y - BODY_RADIUS); y <= Math.floor(point.y + BODY_RADIUS); y++)
    for (let x = Math.floor(point.x - BODY_RADIUS); x <= Math.floor(point.x + BODY_RADIUS); x++) {
      if (canWalk(state, x, y, faction, blockers)) continue;
      const dx = point.x - clamp(point.x, x, x + 1), dy = point.y - clamp(point.y, y, y + 1);
      if (dx * dx + dy * dy < BODY_RADIUS * BODY_RADIUS - 1e-9) return false;
    }
  return true;
}
export function infantrySegmentClear(state: GameState, from: Point, to: Point, faction: number): boolean {
  if (!canMove(state, from, to, faction)) return false;
  const dx = to.x - from.x, dy = to.y - from.y, lengthSquared = dx * dx + dy * dy;
  const pointSegmentSquared = (x: number, y: number): number => {
    const t = lengthSquared ? clamp(((x - from.x) * dx + (y - from.y) * dy) / lengthSquared, 0, 1) : 0;
    return (x - from.x - t * dx) ** 2 + (y - from.y - t * dy) ** 2;
  };
  const blockers = buildingBlockerView(state, faction), radiusSquared = BODY_RADIUS * BODY_RADIUS - 1e-9;
  const minX = Math.floor(Math.min(from.x, to.x) - BODY_RADIUS), maxX = Math.floor(Math.max(from.x, to.x) + BODY_RADIUS);
  for (let y = Math.floor(Math.min(from.y, to.y) - BODY_RADIUS); y <= Math.floor(Math.max(from.y, to.y) + BODY_RADIUS); y++) {
    // Only the narrow swept body can touch an obstacle. Clipping the segment
    // to this row's expanded vertical interval avoids testing every tile in a
    // potentially continent-sized rectangle for a long diagonal detour.
    const a = dy ? clamp((y - BODY_RADIUS - from.y) / dy, 0, 1) : 0;
    const b = dy ? clamp((y + 1 + BODY_RADIUS - from.y) / dy, 0, 1) : 1;
    const ax = from.x + a * dx, bx = from.x + b * dx;
    const rowMin = Math.max(minX, Math.floor(Math.min(ax, bx) - BODY_RADIUS));
    const rowMax = Math.min(maxX, Math.floor(Math.max(ax, bx) + BODY_RADIUS));
    for (let x = rowMin; x <= rowMax; x++) {
      if (canWalk(state, x, y, faction, blockers)) continue;
      // With center-line crossings already rejected above, the closest pair
      // is an endpoint against a box edge, or a box corner against the segment.
      // Exact clearance avoids a long sampled route missing a tiny corner
      // collision that its shorter actual movement steps repeatedly detect.
      const endpoint = (point: Point): number => (point.x - clamp(point.x, x, x + 1)) ** 2 + (point.y - clamp(point.y, y, y + 1)) ** 2;
      if (Math.min(endpoint(from), endpoint(to), pointSegmentSquared(x, y), pointSegmentSquared(x + 1, y),
        pointSegmentSquared(x, y + 1), pointSegmentSquared(x + 1, y + 1)) < radiusSquared) return false;
    }
  }
  return true;
}
/** Smooth a route using bounded shortcut probes. A nearer waypoint is fine
 * when a farther shortcut cannot be proven clear; every accepted segment still
 * uses the exact swept-body collision test. */
export function infantryRoute(state: GameState, from: Point, to: Point, faction: number): Point[] {
  if (!infantryPointClear(state, to, faction)) return [];
  if (infantrySegmentClear(state, from, to, faction)) return [copy(to)];
  const raw = findPath(state, from, to, faction, false, undefined, undefined, undefined, true);
  if (!raw.length) return [];
  const centered = { x: Math.floor(from.x) + .5, y: Math.floor(from.y) + .5 };
  if (!infantrySegmentClear(state, from, raw[0], faction) && infantrySegmentClear(state, from, centered, faction)) raw.unshift(centered);
  const path: Point[] = []; let origin = from, index = 0;
  while (index < raw.length) {
    if (!infantrySegmentClear(state, origin, raw[index], faction)) return [];
    let end = index, blocked = raw.length;
    // Forward doubling avoids testing the whole remaining route backwards
    // for each corner of a long winding path. Visibility need not be monotone:
    // skipping a later visible shortcut only retains an extra safe waypoint.
    for (let stride = 1; end < raw.length - 1; stride *= 2) {
      const candidate = Math.min(raw.length - 1, index + stride);
      if (!infantrySegmentClear(state, origin, raw[candidate], faction)) { blocked = candidate; break; }
      end = candidate;
    }
    while (blocked - end > 1) {
      const candidate = (end + blocked) >>> 1;
      if (infantrySegmentClear(state, origin, raw[candidate], faction)) end = candidate;
      else blocked = candidate;
    }
    path.push(raw[end]); origin = raw[end]; index = end + 1;
  }
  return path;
}
function rotated(center: Point, offset: Point, angle: number): Point {
  return { x: center.x + Math.cos(angle) * offset.x - Math.sin(angle) * offset.y,
    y: center.y + Math.sin(angle) * offset.x + Math.cos(angle) * offset.y };
}
function setRoute(state: GameState, leader: Unit, goal: Point, path: Point[]): void {
  const form = leader.infantryFormation!, tail = (form.slots.length / 2 + 1) * INFANTRY_SPACING;
  const first = path[0], heading = Math.atan2(first.y - leader.y, first.x - leader.x);
  const back = { x: leader.x - Math.cos(heading) * tail, y: leader.y - Math.sin(heading) * tail };
  const history = form.history.length > 1 ? form.history.slice().reverse() : infantrySegmentClear(state, back, leader, leader.faction) ? [back] : [];
  form.spine = [...history, copy(leader), ...path.map(copy)]; form.goal = copy(goal);
  form.lengths = [0];
  for (let i = 1; i < form.spine.length; i++) form.lengths.push(form.lengths[i - 1] + distance(form.spine[i - 1], form.spine[i]));
  form.progress = form.lengths[history.length]; form.goalDistance = form.lengths.at(-1)!;
  const last = path.at(-1)!, previous = path.length > 1 ? path.at(-2)! : leader, angle = Math.atan2(last.y - previous.y, last.x - previous.x);
  const extension = { x: last.x + Math.cos(angle) * tail, y: last.y + Math.sin(angle) * tail };
  if (infantrySegmentClear(state, last, extension, leader.faction)) { form.spine.push(extension); form.lengths.push(form.goalDistance + tail); }
}
function sample(form: InfantryFormationState, at: number, fallback: Point): Point {
  if (!form.spine.length) return copy(fallback);
  at = clamp(at, 0, form.lengths.at(-1)!);
  for (let i = 1; i < form.spine.length; i++) if (at <= form.lengths[i]) {
    const fraction = (at - form.lengths[i - 1]) / Math.max(1e-9, form.lengths[i] - form.lengths[i - 1]);
    return { x: form.spine[i - 1].x + (form.spine[i].x - form.spine[i - 1].x) * fraction,
      y: form.spine[i - 1].y + (form.spine[i].y - form.spine[i - 1].y) * fraction };
  }
  return copy(form.spine.at(-1)!);
}
function targetFor(leader: Unit, index: number): Point {
  return rotated(leader, leader.infantryFormation!.slots[index], leader.infantryFormation!.heading);
}

function memberRoute(state: GameState, rt: Runtime, unit: Unit, target: Point): Point[] | undefined {
  let budget = rt.searchBudgets.get(unit.id);
  if (!budget || state.time >= budget.until) {
    budget = { until: state.time + CHECK_INTERVAL, remaining: 2 }; rt.searchBudgets.set(unit.id, budget);
  }
  if (budget.remaining <= 0) return;
  // A hidden group's wake-up must share the same fair route budget as other
  // moving units. Deferral retains both local search credit and any old route.
  if (!requestMovementPath(state, unit)) return;
  budget.remaining--;
  return infantryRoute(state, unit, target, unit.faction);
}
function plannedRoute(state: GameState, rt: Runtime, unit: Unit, target: Point): Point[] {
  let pending = rt.routes.get(unit.id);
  const staleSegment = !!pending?.path.length && !infantrySegmentClear(state, unit, pending.path[0], unit.faction);
  if ((!pending?.path.length || distance(pending.target, target) > .35 || staleSegment) && state.time >= (pending?.retryAt ?? 0)) {
    const path = memberRoute(state, rt, unit, target);
    if (path !== undefined) {
      pending = { path, target: copy(target), retryAt: state.time + CHECK_INTERVAL }; rt.routes.set(unit.id, pending);
    } else if (staleSegment) return [];
  }
  while (pending?.path.length && distance(unit, pending.path[0]) < .025) pending.path.shift();
  return pending?.path ?? [];
}

/** Keep every usable rectangular destination, even when a wall lies between
 * that slot and the Leader. Only a soldier's own terrain/path can displace it.
 * Nearby blocked slots share reserved temporary positions, not a new army-wide
 * layout; a short individual detour naturally threads the ranks through gates. */
function localGoal(state: GameState, leader: Unit, member: Unit, ideal: Point, rt: Runtime, reserved: Point[]): Point {
  if (infantryPointClear(state, ideal, member.faction)) {
    if (infantrySegmentClear(state, member, ideal, member.faction)) { rt.temporary.delete(member.id); return ideal; }
    rt.adjusted.add(member.id);
    if (plannedRoute(state, rt, member, ideal).length) { rt.temporary.delete(member.id); return ideal; }
  }
  rt.adjusted.add(member.id);
  const previous = rt.temporary.get(member.id), candidates: { point: Point; score: number }[] = [];
  const consider = (point: Point): void => {
    if (!infantryPointClear(state, point, member.faction) || reserved.some(other => distance(point, other) < .36)) return;
    if (candidates.some(candidate => distance(candidate.point, point) < .01)) return;
    candidates.push({ point, score: distance(point, ideal) + distance(point, member) * .06
      + (previous ? Math.min(1, distance(point, previous)) * .12 : 0) });
  };
  // Project onto nearby tile interiors. This produces a minimal sidestep along
  // the obstacle, preserving the same forward/lateral coordinate where possible.
  for (let y = Math.floor(ideal.y) - 3; y <= Math.floor(ideal.y) + 3; y++) for (let x = Math.floor(ideal.x) - 3; x <= Math.floor(ideal.x) + 3; x++)
    consider({ x: clamp(ideal.x, x + BODY_RADIUS + .01, x + 1 - BODY_RADIUS - .01),
      y: clamp(ideal.y, y + BODY_RADIUS + .01, y + 1 - BODY_RADIUS - .01) });
  const form = leader.infantryFormation!;
  if (form.spine.length) for (let offset = -form.slots.length * .4; offset <= form.slots.length * .4; offset += .4)
    consider(sample(form, form.progress + offset, leader));
  if (previous) consider(previous);
  consider(copy(member));
  candidates.sort((a, b) => a.score - b.score || a.point.y - b.point.y || a.point.x - b.point.x);
  let goal: Point | undefined;
  // Directly reachable near alternatives require no navigation search. Try a
  // few nearer detours only if the closest direct choice is meaningfully worse.
  const direct = candidates.find(candidate => infantrySegmentClear(state, member, candidate.point, member.faction));
  for (const candidate of candidates.slice(0, 4)) {
    if (direct && candidate.score >= direct.score - .2) break;
    const path = memberRoute(state, rt, member, candidate.point);
    if (path === undefined) break;
    if (path.length) {
      rt.routes.set(member.id, { path, target: copy(candidate.point), retryAt: state.time + CHECK_INTERVAL }); goal = candidate.point; break;
    }
  }
  goal ??= direct?.point ?? previous ?? copy(member);
  rt.temporary.set(member.id, goal); return goal;
}
function walk(state: GameState, runtime: Runtime, unit: Unit, target: Point, speed: number, dt: number, move: InfantryMove): void {
  unit.moving = false; if (distance(unit, target) < SETTLED_DISTANCE) return;
  let point = target;
  if (!infantrySegmentClear(state, unit, target, unit.faction)) {
    const pending = plannedRoute(state, runtime, unit, target);
    if (!pending.length) return; point = pending[0];
  } else runtime.routes.delete(unit.id);
  const length = distance(unit, point), step = Math.min(length, speed * dt);
  if (length < SETTLED_DISTANCE) return;
  const next = { x: unit.x + (point.x - unit.x) * step / length, y: unit.y + (point.y - unit.y) * step / length };
  if (infantrySegmentClear(state, unit, next, unit.faction)) move(unit, next, speed, dt);
}

/** The whole group moves before its combat decisions, independent of save-file
 * unit order. Normal live movement still handles enemy traffic and terrain pace. */
export function advanceInfantryFormations(state: GameState, frameDt: number, inputFor: (faction: number) => InputState, move: InfantryMove): void {
  let strengthClock = strengthClocks.get(state);
  if (!strengthClock) { strengthClock = {}; strengthClocks.set(state, strengthClock); }
  if (!simulationReadsActive(state) || decisionDue(strengthClock, state.time, 913)) {
    enforceInfantryFormationStrength(state);
    for (const unit of state.units) unit.infantryDrillLeader = undefined;
  }
  const commanders = [...entityStore(state).units.query('leader'), ...state.units.filter(unit => unit.marauderLeader && unit.infantryFormation?.active)];
  for (const leader of commanders) {
    if (!leader.infantryFormation?.active) continue;
    const form = leader.infantryFormation, previousHeading = form.heading;
    if (leader.marauderLeader ? !available(leader) : !infantryFormationActive(state, leader.faction)) { form.active = false; continue; }
    const rt = runtime(state, leader);
    let dt = frameDt;
    if (leader.marauderLeader && rt.members.length) {
      dt = marauderFormationElapsed(state, leader, rt.members, frameDt);
      if (!dt) {
        // Keep combat membership valid even on a skipped hidden movement step.
        leader.infantryDrillLeader = leader.id;
        for (const member of rt.members) if (eligible(member, leader)) member.infantryDrillLeader = leader.id;
        continue;
      }
    }
    const think = !simulationReadsActive(state) || decisionDue(rt.planning, state.time, leader.id);
    if (think) {
      form.type = militaryFormationType(state, leader.faction);
      rt.members = (simulationReadsActive(state) ? entityStore(state).units.query('soldier') : state.units).filter(unit => eligible(unit, leader));
      synchronizeSlots(state, form, rt.members, rt);
      // Each retained route validates its next segment below. Distant roads,
      // crop appearance and unrelated construction need not discard it.
      rt.byId = new Map(rt.members.map(unit => [unit.id, unit]));
      rt.speed = Math.min(leader.speed, ...rt.members.map(unit => unit.speed)) * INFANTRY_FORMATION_SPEED;
      rt.outer = Math.max(1, ...form.slots.map(slot => Math.hypot(slot.x, slot.y)));
    }
    const members = rt.members, byId = rt.byId;
    leader.infantryDrillLeader = leader.id;
    for (const member of members) member.infantryDrillLeader = leader.id;
    const speed = whalingMovementSpeed(state, leader.faction, rt.speed);
    const catchup = speed * INFANTRY_CATCHUP_MULTIPLIER, input = inputFor(leader.faction);
    const turn = Number(!!input.turnRight) - Number(!!input.turnLeft);
    const outer = rt.outer;
    const angularSpeed = Math.min(1.25, catchup * .7 / outer);
    if (input.turnLeft || input.turnRight) { form.heading += turn * angularSpeed * dt; form.manualFacing = true; }
    const forward = Number(input.up) - Number(input.down), side = Number(input.right) - Number(input.left), keyboard = !!(forward || side);
    if (keyboard) {
      leader.target = undefined; leader.destination = undefined; leader.path = undefined;
      if (!rt.keyboard || forward !== rt.keyboardY || side !== rt.keyboardX || think && (state.time >= rt.keyboardPlanAt || Math.abs(angleDelta(rt.keyboardHeading, form.heading)) > .04)) {
        const length = Math.hypot(forward, side), dx = (Math.cos(form.heading) * forward - Math.sin(form.heading) * side) / length;
        const dy = (Math.sin(form.heading) * forward + Math.cos(form.heading) * side) / length;
        let goal = copy(leader);
        for (let d = .2; d <= (members.length / 2 + 1) * INFANTRY_SPACING + 4; d += .2) {
          const next = { x: leader.x + dx * d, y: leader.y + dy * d };
          if (!infantrySegmentClear(state, goal, next, leader.faction)) break; goal = next;
        }
        if (distance(leader, goal) > .01) setRoute(state, leader, goal, [goal]);
        else { form.goal = undefined; form.goalDistance = form.progress; }
        rt.keyboardPlanAt = state.time + .4; rt.keyboardHeading = form.heading; rt.keyboardX = side; rt.keyboardY = forward;
      }
    } else if (rt.keyboard) { form.goal = undefined; form.goalDistance = form.progress; }
    rt.keyboard = keyboard;
    if (!keyboard && leader.destination && (!form.goal || distance(form.goal, leader.destination) > .01)) {
      const path = infantryRoute(state, leader, leader.destination, leader.faction);
      if (path.length) { setRoute(state, leader, leader.destination, path); if (!input.turnLeft && !input.turnRight) form.manualFacing = false; }
      else { form.goal = undefined; leader.destination = undefined; }
    }
    const marching = !!form.goal && form.progress < form.goalDistance - .005;
    const tangent = sample(form, Math.min(form.goalDistance, form.progress + .3), leader);
    const desired = !form.manualFacing && !keyboard && marching ? Math.atan2(tangent.y - leader.y, tangent.x - leader.x) : form.heading;
    if (!turn) form.heading += clamp(angleDelta(form.heading, desired), -angularSpeed * dt, angularSpeed * dt);
    if (Math.abs(angleDelta(previousHeading, form.heading)) > 1e-7) form.lastTurnAt = state.time;
    // One detouring flank must not stop every clear rank. Slow only while a
    // substantial share is stretched, or an individual has fallen far behind.
    if (think) {
      const errors = form.slots.map((slot, index) => distance(byId.get(slot.id)!, rt.goals.get(slot.id) ?? targetFor(leader, index)));
      const stragglers = errors.filter(error => error > 1.4).length;
      if (stragglers >= Math.max(2, Math.ceil(members.length / 3)) || errors.some(error => error > 8)) form.slow = true;
      else if (errors.filter(error => error > .5).length < Math.max(2, Math.ceil(members.length / 3))) form.slow = false;
    }
    const previous = copy(leader); leader.moving = false;
    if (marching) {
      const motion = form.slow || Math.abs(angleDelta(form.heading, desired)) > .15 ? .15 : 1;
      const nextProgress = Math.min(form.goalDistance, form.progress + speed * motion * dt), next = sample(form, nextProgress, leader);
      if (infantrySegmentClear(state, leader, next, leader.faction)) {
        move(leader, next, speed * motion, dt);
        form.progress = Math.min(nextProgress, form.progress + distance(previous, leader));
      } else { form.goal = undefined; rt.keyboardPlanAt = 0; }
      if (form.progress >= form.goalDistance - .005) { leader.destination = undefined; form.goal = undefined; }
    }
    leader.facing = form.heading;
    if (distance(form.history[0] ?? leader, leader) >= .12) form.history.unshift(copy(leader));
    let historyLength = 0;
    for (let i = 1; i < form.history.length; i++) { historyLength += distance(form.history[i - 1], form.history[i]); if (historyLength > (members.length + 3) * INFANTRY_SPACING) { form.history.length = i + 1; break; } }
    if (think) {
      rt.goals.clear(); rt.adjusted.clear();
      const ideals = form.slots.map((slot, index) => ({ member: byId.get(slot.id)!, point: targetFor(leader, index) }));
      // Slot and detour searches share the leader's capped planning step.
      const reserved = [copy(leader), ...ideals.filter(candidate => infantryPointClear(state, candidate.point, leader.faction)).map(candidate => candidate.point)];
      for (const { member, point } of ideals) {
        const goal = localGoal(state, leader, member, point, rt, reserved); rt.goals.set(member.id, goal);
        if (distance(goal, point) > .001) reserved.push(goal);
      }
      cannonRearGoals(state, members, rt.goals, leader, form.heading, id => { rt.adjusted.add(id); rt.routes.delete(id); });
      const mode = rt.adjusted.size ? 'column' : 'rectangle';
      if (mode !== form.mode) { form.mode = mode; form.modeSince = state.time; }
    }
    rt.goals.set(leader.id, copy(leader));
    // Nominal slot transforms are movement, not a new neighborhood/route scan.
    // Keep them attached to the moving Leader between expensive layout plans.
    if (!think) for (let index = 0; index < form.slots.length; index++) {
      const slot = form.slots[index];
      if (!rt.adjusted.has(slot.id)) rt.goals.set(slot.id, targetFor(leader, index));
    }
    for (const member of members) {
      if (!eligible(member, leader)) { member.infantryDrillLeader = undefined; continue; }
      const goal = rt.goals.get(member.id);
      if (!goal) continue;
      if (member.kind === 'fieldCannon') continue; // Native artillery movement consumes this same goal.
      walk(state, rt, member, goal, catchup, dt, move); member.facing = form.heading;
      if (distance(member, goal) < .5) member.joiningRetinue = undefined;
    }

  }
}

export function infantryFormationLeader(state: GameState, unit: Unit): Unit | undefined {
  if (unit.infantryDrillLeader === undefined || unit.hp <= 0 || unit.inside || unit.order === 'flee') return;
  const leader = entityStore(state).units.get(unit.infantryDrillLeader);
  return leader?.faction === unit.faction && leader.infantryFormation?.active && available(leader) ? leader : undefined;
}
export function infantryFormationGoal(state: GameState, unit: Unit): Point | undefined {
  const leader = infantryFormationLeader(state, unit); return leader && runtime(state, leader).goals.get(unit.id);
}
/** Direction always uses the army heading. Detached replacements do not gain
 * formation protection until they physically take their place in the ranks. */
function formationFront(state: GameState, unit: Unit, other: Point): boolean {
  const leader = infantryFormationLeader(state, unit); if (!leader) return false;
  const goal = infantryFormationGoal(state, unit);
  if (unit !== leader && (!goal || distance(unit, goal) > .9)) return false;
  return Math.cos(angleDelta(leader.infantryFormation!.heading, Math.atan2(other.y - unit.y, other.x - unit.x))) >= .5 - 1e-9;
}
export function infantryAttackMultiplier(state: GameState, unit: Unit, other: Point): number {
  const front = formationFront(state, unit, other);
  return rustEngine.infantry_formation_modifier(militaryFormationCode(infantryFormationLeader(state, unit)?.infantryFormation?.type), UNIT_KIND_CODES[unit.kind], 0, Number(front), Number(front));
}
export function infantryDefenseMultiplier(state: GameState, unit: Unit, other: Point): number {
  const front = formationFront(state, unit, other);
  return rustEngine.infantry_formation_modifier(militaryFormationCode(infantryFormationLeader(state, unit)?.infantryFormation?.type), UNIT_KIND_CODES[unit.kind], 1, Number(front), Number(front));
}
/** Wide missile ranks trade frontal protection for a faster firing cycle. */
export function infantryAttackCooldown(state: GameState, unit: Unit, cooldown: number): number {
  const leader = infantryFormationLeader(state, unit), goal = leader && infantryFormationGoal(state, unit);
  return rustEngine.infantry_formation_cooldown(militaryFormationCode(leader?.infantryFormation?.type), UNIT_KIND_CODES[unit.kind],
    Number(!!leader), Number(unit === leader), goal ? distance(unit, goal) : NaN, cooldown);
}
/** Briefly retain the direction cue after a turn so releasing a key does not
 * abruptly flash it off. Both held rotation and automatic wheeling update it. */
export function infantryRotationAlpha(leader: Unit, time: number): number {
  const form = leader.infantryFormation;
  if (!form?.active || !available(leader) || form.lastTurnAt === undefined) return 0;
  return .42 * clamp(1 - (time - form.lastTurnAt) / .25, 0, 1);
}
