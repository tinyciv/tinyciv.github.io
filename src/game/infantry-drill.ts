import { simulationReadsActive } from './simulation-reads';
import { announceArmyMobilization } from './army-warnings';
import { decisionDue, type DecisionClock } from './decision-schedule';
import { CHECK_INTERVAL } from './work-cadence';
import { buildingBlockerView, canMove, canWalk, findPath } from './pathfinding';
import { playerFaction } from './player-context';
import { isInfantryDrillUnlocked } from './research';
import { entityStore } from './entity-store';
import { beginBattleRout } from './battle-morale';
import { distance, isSoldier, type GameState, type InputState, type Point, type Unit } from './types';

export const INFANTRY_FORMATION_SPEED = .7 * 1.5;
export const INFANTRY_CATCHUP_MULTIPLIER = 1.25;
export const INFANTRY_SPACING = .72;
export const INFANTRY_FORMATION_ASPECT = 1.6;
export const LARGE_INFANTRY_FORMATION_ASPECT = 2.2;
export const LARGE_INFANTRY_FORMATION_THRESHOLD = 30;
export const infantryFormationAspect = (soldiers: number): number => soldiers > LARGE_INFANTRY_FORMATION_THRESHOLD
  ? LARGE_INFANTRY_FORMATION_ASPECT : INFANTRY_FORMATION_ASPECT;
export const INFANTRY_ATTACK_MULTIPLIER = 1.25;
export const INFANTRY_DEFENSE_MULTIPLIER = 1.5;
export const INFANTRY_FORMATION_MIN_START = 8;
export const INFANTRY_FORMATION_MIN_REMAINING = 5;
const BODY_RADIUS = .17, SETTLED_DISTANCE = .008;
const copy = (point: Point): Point => ({ x: point.x, y: point.y });
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const angleDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
export interface InfantryFormationState {
  active: boolean; heading: number; manualFacing?: boolean; lastTurnAt?: number; mode: 'rectangle' | 'column'; modeSince: number;
  slots: { id: number; x: number; y: number }[];
  spine: Point[]; lengths: number[]; progress: number; goalDistance: number; goal?: Point;
  history: Point[]; slow: boolean;
}
interface Runtime {
  world: GameState['world']; keyboard: boolean; keyboardPlanAt: number; keyboardHeading: number;
  keyboardX: number; keyboardY: number; revision?: number; goals: Map<number, Point>;
  routes: Map<number, { path: Point[]; target: Point; retryAt: number }>;
  adjusted: Set<number>; temporary: Map<number, Point>;
  searchBudgets: Map<number, { until: number; remaining: number }>;
  validatedSlots?: InfantryFormationState['slots'];
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
  if (!available(leader)) return { ok: false, message: 'Your Leader must be alive and on land.' };
  if (infantryFormationSoldierCount(state, faction) < INFANTRY_FORMATION_MIN_START)
    return { ok: false, message: `Formation requires ${INFANTRY_FORMATION_MIN_START} living retinue soldiers.` };
  leader.infantryFormation = { active: true, heading: leader.facing, mode: 'rectangle', modeSince: state.time,
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
/** Balanced ranks describe a rectangle, rather than filling a diamond outward
 * from its center. Local x is forward, so the longer y axis is across the march.
 * Choose the most compact rank count, then expand spacing on just one axis to
 * reach 1.6:1 (2.2:1 above thirty soldiers) without crowding ordinary drill spacing.
 * The Leader occupies the center; even retinues retain opposite slot pairs. */
export function infantryRectangleOffsets(count: number): Point[] {
  count = Math.max(0, Math.floor(count));
  const aspect = infantryFormationAspect(count);
  if (!count) return [];
  if (count <= 2) return [{ x: -INFANTRY_SPACING / aspect, y: -INFANTRY_SPACING },
    { x: INFANTRY_SPACING / aspect, y: INFANTRY_SPACING }].slice(0, count);
  // An odd number leaves one vacancy in otherwise symmetric ranks. Removing
  // an interior slot below keeps the bounding rectangle and Leader centered.
  const total = count + count % 2 + 1;
  let layout: { ranks: number[]; depthSpacing: number; widthSpacing: number; width: number } | undefined;
  for (let rows = 3; rows <= Math.max(3, Math.ceil(Math.sqrt(total)) + 2); rows += 2) {
    const base = Math.floor(total / rows), middle = base % 2 ? base : base + 1, paired = total - middle;
    const perRank = Math.floor(paired / (rows - 1));
    if (perRank < 1) continue;
    const extraPairs = (paired - perRank * (rows - 1)) / 2, half = (rows - 1) / 2;
    const ranks = Array.from({ length: rows }, (_, row) => row === half ? middle
      : perRank + Number(Math.min(row, rows - 1 - row) < extraPairs));
    const columns = Math.max(...ranks);
    const width = Math.max((columns - 1) * INFANTRY_SPACING, (rows - 1) * INFANTRY_SPACING * aspect);
    if (!layout || width < layout.width - 1e-9)
      layout = { ranks, width, widthSpacing: width / (columns - 1), depthSpacing: width / aspect / (rows - 1) };
  }
  const { ranks, depthSpacing, widthSpacing } = layout!, result: Point[] = [];
  for (let row = 0; row < ranks.length; row++) for (let column = 0; column < ranks[row]; column++) {
    const x = (row - (ranks.length - 1) / 2) * depthSpacing, y = (column - (ranks[row] - 1) / 2) * widthSpacing;
    if (x || y) result.push({ x, y });
  }
  if (result.length > count) {
    // Prefer the vacancy nearest the center, rather than clipping a corner.
    let nearest = 0;
    for (let index = 1; index < result.length; index++)
      if (Math.hypot(result[index].x, result[index].y) < Math.hypot(result[nearest].x, result[nearest].y)) nearest = index;
    result.splice(nearest, 1);
  }
  return result;
}
function synchronizeSlots(formation: InfantryFormationState, members: Unit[], rt: Runtime): void {
  const byId = new Map(members.map(unit => [unit.id, unit]));
  if (rt.validatedSlots === formation.slots && formation.slots.length === members.length
    && members.every(unit => rt.validatedRoles?.get(unit.id) === unit.kind)) return;
  const role = (unit: Unit): 'levy' | 'ranged' | 'melee' => unit.kind === 'levyInfantry' ? 'levy' : unit.kind === 'archer' || unit.range > 1.5 ? 'ranged' : 'melee';
  const offsets = infantryRectangleOffsets(members.length);
  // Local +x is forward and y is lateral. The least protected troops occupy
  // the outer wings; ranged regulars take the rear among the remaining cells.
  const levyCount = members.filter(unit => role(unit) === 'levy').length;
  const wings = new Set(offsets.slice().sort((a, b) => Math.abs(b.y) - Math.abs(a.y) || b.x - a.x || a.y - b.y).slice(0, levyCount));
  const rangedCount = members.filter(unit => role(unit) === 'ranged').length;
  const rear = new Set(offsets.filter(offset => !wings.has(offset)).sort((a, b) => a.x - b.x || Math.abs(a.y) - Math.abs(b.y) || a.y - b.y).slice(0, rangedCount));
  const slotRole = (offset: Point) => wings.has(offset) ? 'levy' : rear.has(offset) ? 'ranged' : 'melee';
  const valid = formation.slots.length === members.length && formation.slots.every(slot => {
    const member = byId.get(slot.id), offset = offsets.find(point => point.x === slot.x && point.y === slot.y);
    return !!member && !!offset && role(member) === slotRole(offset);
  });
  if (valid) { rt.validatedSlots = formation.slots; rt.validatedRoles = new Map(members.map(unit => [unit.id, unit.kind])); return; }
  const remaining = members.slice().sort((a, b) => a.id - b.id), slots: InfantryFormationState['slots'] = [];
  for (const offset of offsets) {
    const old = formation.slots.find(slot => slot.x === offset.x && slot.y === offset.y
      && byId.has(slot.id) && role(byId.get(slot.id)!) === slotRole(offset));
    if (old) { slots.push(old); remaining.splice(remaining.findIndex(unit => unit.id === old.id), 1); }
    else slots.push({ id: -1, ...offset });
  }
  for (let index = 0; index < slots.length; index++) if (slots[index].id < 0) {
    const next = remaining.findIndex(unit => role(unit) === slotRole(offsets[index]));
    slots[index].id = remaining.splice(next, 1)[0].id;
  }
  formation.slots = slots; rt.validatedSlots = slots; rt.validatedRoles = new Map(members.map(unit => [unit.id, unit.kind]));
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
  for (let y = Math.floor(Math.min(from.y, to.y) - BODY_RADIUS); y <= Math.floor(Math.max(from.y, to.y) + BODY_RADIUS); y++)
    for (let x = Math.floor(Math.min(from.x, to.x) - BODY_RADIUS); x <= Math.floor(Math.max(from.x, to.x) + BODY_RADIUS); x++) {
      if (canWalk(state, x, y, faction, blockers)) continue;
      // With center-line crossings already rejected above, the closest pair
      // is an endpoint against a box edge, or a box corner against the segment.
      // Exact clearance avoids a long sampled route missing a tiny corner
      // collision that its shorter actual movement steps repeatedly detect.
      const endpoint = (point: Point): number => (point.x - clamp(point.x, x, x + 1)) ** 2 + (point.y - clamp(point.y, y, y + 1)) ** 2;
      if (Math.min(endpoint(from), endpoint(to), pointSegmentSquared(x, y), pointSegmentSquared(x + 1, y),
        pointSegmentSquared(x, y + 1), pointSegmentSquared(x + 1, y + 1)) < radiusSquared) return false;
    }
  return true;
}
function route(state: GameState, from: Point, to: Point, faction: number): Point[] {
  if (!infantryPointClear(state, to, faction)) return [];
  if (infantrySegmentClear(state, from, to, faction)) return [copy(to)];
  const raw = findPath(state, from, to, faction, false, undefined, undefined, undefined, true);
  if (!raw.length) return [];
  const centered = { x: Math.floor(from.x) + .5, y: Math.floor(from.y) + .5 };
  if (!infantrySegmentClear(state, from, raw[0], faction) && infantrySegmentClear(state, from, centered, faction)) raw.unshift(centered);
  const path: Point[] = []; let origin = from, index = 0;
  while (index < raw.length) {
    let end = raw.length - 1;
    while (end > index && !infantrySegmentClear(state, origin, raw[end], faction)) end--;
    if (!infantrySegmentClear(state, origin, raw[end], faction)) return [];
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
  budget.remaining--;
  return route(state, unit, target, unit.faction);
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
export function advanceInfantryFormations(state: GameState, dt: number, inputFor: (faction: number) => InputState, move: InfantryMove): void {
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
    const rt = runtime(state, leader), think = !simulationReadsActive(state) || decisionDue(rt.planning, state.time, leader.id);
    if (think) {
      rt.members = (simulationReadsActive(state) ? entityStore(state).units.query('soldier') : state.units).filter(unit => eligible(unit, leader));
      synchronizeSlots(form, rt.members, rt);
      if (rt.revision !== state.world.revision) { rt.routes.clear(); rt.revision = state.world.revision; }
      rt.byId = new Map(rt.members.map(unit => [unit.id, unit]));
      rt.speed = Math.min(leader.speed, ...rt.members.map(unit => unit.speed)) * INFANTRY_FORMATION_SPEED;
      rt.outer = Math.max(1, ...form.slots.map(slot => Math.hypot(slot.x, slot.y)));
    }
    const members = rt.members, byId = rt.byId;
    leader.infantryDrillLeader = leader.id;
    for (const member of members) member.infantryDrillLeader = leader.id;
    const speed = rt.speed;
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
      const path = route(state, leader, leader.destination, leader.faction);
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
  return formationFront(state, unit, other) ? INFANTRY_ATTACK_MULTIPLIER : 1;
}
export function infantryDefenseMultiplier(state: GameState, unit: Unit, other: Point): number {
  return formationFront(state, unit, other) ? INFANTRY_DEFENSE_MULTIPLIER : 1;
}
/** Briefly retain the direction cue after a turn so releasing a key does not
 * abruptly flash it off. Both held rotation and automatic wheeling update it. */
export function infantryRotationAlpha(leader: Unit, time: number): number {
  const form = leader.infantryFormation;
  if (!form?.active || !available(leader) || form.lastTurnAt === undefined) return 0;
  return .42 * clamp(1 - (time - form.lastTurnAt) / .25, 0, 1);
}
