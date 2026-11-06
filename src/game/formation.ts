import { simulationReadsActive } from './simulation-reads';
import { CHECK_INTERVAL } from './work-cadence';
import { unitAttackRange } from './combat-range';
import { isHumanFaction, movementModeFor } from './player-context';
import { isSoldier } from './types';
import { type GameState, type Point, type Unit, buildingWidth, buildingHeight, distance } from './types';
import { buildingBlockerView, canMove, canTraverseEdge, canWalk, type CellBlockers } from './pathfinding';
import { getFactionStrategy } from './faction-strategy';
import { indexedBuilding, indexedUnit, nearbyUnits, unitsWithRole } from './spatial';
import { decisionDue, decisionRevision, type DecisionClock } from './decision-schedule';
import { entityStore } from './entity-store';

interface Formation {
  state: GameState;
  world: GameState['world'];
  time: number;
  commands: number;
  membersRevision: number;
  worldRevision?: number;
  heading: number;
  mode: 'line' | 'mob' | 'column';
  clearSince?: number;
  previous: Point;
  goalAnchor: Point;
  trail: Point[];
  slots: Map<number, number>;
  goals: Map<number, Point>;
  marching?: boolean;
  traveling: boolean;
  motion: { point: Point; time: number }[];
  rally: DecisionClock;
  rallyCell?: number;
  rallyTopology?: CellBlockers;
  rallyRevision?: number;
  rallyCommands?: number;
}
const formations = new WeakMap<Unit, Formation>();
const orderedSoldiers = new WeakMap<readonly Unit[], readonly Unit[]>();
/** Role views change only when membership changes. Stable ID ordering belongs
 * to that roster, not to every leader's movement update. Live eligibility is
 * still checked below so death, combat contact and orders take effect at once. */
function formationRoster(state: GameState): readonly Unit[] {
  const soldiers = unitsWithRole(state, 'soldier');
  let ordered = orderedSoldiers.get(soldiers);
  if (!ordered) { ordered = [...soldiers].sort((a, b) => a.id - b.id); orderedSoldiers.set(soldiers, ordered); }
  return ordered;
}
const centered = (point: Point): Point => ({ x: Math.floor(point.x) + .5, y: Math.floor(point.y) + .5 });
const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** Reassign the same reachable cells, keeping levies on both outside wings. */
function levyWingGoals(leader: Unit, members: Unit[], goals: Map<number, Point>, heading: number): Map<number, Point> {
  const levies = members.filter(unit => unit.kind === 'levyInfantry' && goals.has(unit.id));
  if (!levies.length) return goals;
  const role = (unit: Unit): 'levy' | 'ranged' | 'melee' => unit.kind === 'levyInfantry' ? 'levy' : unit.kind === 'archer' || unit.range > 1.5 ? 'ranged' : 'melee';
  const side = { x: -Math.sin(heading), y: Math.cos(heading) }, front = { x: Math.cos(heading), y: Math.sin(heading) };
  const projection = (point: Point, axis: Point) => (point.x - leader.x) * axis.x + (point.y - leader.y) * axis.y;
  const entries = [...goals.entries()].map(([id, point]) => ({ id, point }));
  const wings = new Set(entries.slice().sort((a, b) => Math.abs(projection(b.point, side)) - Math.abs(projection(a.point, side))
    || projection(a.point, side) - projection(b.point, side) || a.id - b.id).slice(0, levies.length));
  const rangedCount = members.filter(unit => role(unit) === 'ranged').length;
  const rear = new Set(entries.filter(entry => !wings.has(entry)).sort((a, b) => projection(a.point, front) - projection(b.point, front)
    || projection(a.point, side) - projection(b.point, side) || a.id - b.id).slice(0, rangedCount));
  const slotRole = (entry: typeof entries[number]) => wings.has(entry) ? 'levy' : rear.has(entry) ? 'ranged' : 'melee';
  const byId = new Map(members.map(unit => [unit.id, unit])), result = new Map<number, Point>(), occupied = new Set<Point>();
  for (const entry of entries) if (byId.has(entry.id) && role(byId.get(entry.id)!) === slotRole(entry)) {
    result.set(entry.id, entry.point); occupied.add(entry.point);
  }
  const waiting = members.filter(unit => !result.has(unit.id));
  for (const entry of entries) if (!occupied.has(entry.point)) {
    let chosen = -1, bestDistance = Infinity;
    for (let i = 0; i < waiting.length; i++) {
      const unit = waiting[i];
      if (role(unit) !== slotRole(entry)) continue;
      const d = distance(unit, entry.point);
      if (chosen < 0 || (d - bestDistance || unit.id - waiting[chosen].id) < 0) { chosen = i; bestDistance = d; }
    }
    const unit = waiting.splice(chosen, 1)[0]; result.set(unit.id, entry.point); occupied.add(entry.point);
  }
  return result;
}

/** Opposite pairs keep a compact crowd centered on its Leader. World-aligned
 * slots remain stable through turns instead of rotating soldiers across him. */
function mobOffset(slot: number): Point {
  let ring = 1;
  while (slot >= ring * 8) { slot -= ring * 8; ring++; }
  const half: Point[] = [{ x: -ring, y: -ring }, { x: ring, y: -ring }];
  for (let i = -ring + 1; i < ring; i++) half.push({ x: i, y: -ring });
  for (let i = -ring + 1; i < ring; i++) half.push({ x: -ring, y: i });
  const point = half[Math.floor(slot / 2)], sign = slot % 2 ? -1 : 1;
  return { x: point.x * sign * 1.25, y: point.y * sign * 1.25 };
}

/** A stopped column must fill the ground that is actually available around
 * its Leader. One obstructed ideal slot cannot hold every escort in line. */
function rallyGoals(state: GameState, leader: Unit, members: Unit[], previous: Map<number, Point>, blockers: CellBlockers): Map<number, Point> {
  if (!members.length) return new Map();
  const { width, height } = state.world, key = (point: Point) => Math.floor(point.y) * width + Math.floor(point.x);
  interface Cell { point: Point; index: number; distance: number; open: boolean }
  const origin = centered(leader), first: Cell = { point: origin, index: key(origin), distance: distance(origin, leader),
    open: canWalk(state, origin.x, origin.y, leader.faction, blockers) };
  const queue = [first], seen = new Set([first.index]), cells: Cell[] = [], known = new Map<number, Cell>([[first.index, first]]);
  const memberIds = new Set(members.map(member => member.id));
  const occupied = new Set<number>();
  const radius = Math.min(12, Math.max(4, Math.ceil(Math.sqrt(members.length + 1)) + 2));
  for (const unit of nearbyUnits(state, leader, radius + 1)) if (unit.hp > 0 && !unit.inside && unit !== leader && !memberIds.has(unit.id)) occupied.add(key(unit));
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head], point = current.point;
    if (!current.open) continue;
    if (head > 0 && !occupied.has(current.index)) cells.push(current);
    const cx = Math.floor(point.x), cy = Math.floor(point.y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = cx + dx, y = cy + dy, at = y * width + x;
      if (x < 0 || y < 0 || x >= width || y >= height || seen.has(at)) continue;
      let next = known.get(at);
      if (!next) {
        const point = { x: x + .5, y: y + .5 }, d = distance(point, leader);
        next = { point, index: at, distance: d, open: d <= radius && canWalk(state, x, y, leader.faction, blockers) };
        known.set(at, next);
      }
      // Both endpoints are neighboring cell centers. Their cached walkability
      // plus this elevation edge is exactly the sweep canMove would perform.
      // A blocked edge is not a blocked cell: another ramp approach may work.
      if (!next.open || !canTraverseEdge(state.world, point, next.point)) continue;
      seen.add(at); queue.push(next);
    }
  }
  cells.sort((a, b) => a.distance - b.distance || a.point.y - b.point.y || a.point.x - b.point.x);
  // Leave a little choice around obstacles, without assigning rear soldiers
  // distant empty posts merely because they arrived later.
  const available = new Map(cells.slice(0, members.length + 2).map(cell => [cell.index, cell]));
  const goals = new Map<number, Point>();
  for (const member of members) {
    const old = previous.get(member.id), cell = old && available.get(key(old));
    if (cell) { goals.set(member.id, cell.point); available.delete(cell.index); }
  }
  if (goals.size === members.length) return goals;
  const ordered = members.map(member => ({ member, distance: distance(member, leader) }))
    .sort((a, b) => a.distance - b.distance || a.member.id - b.member.id);
  for (const { member } of ordered) {
    if (goals.has(member.id)) continue;
    // Select the same first minimum as the stable sort without allocating and
    // sorting the remaining cell list again for every unassigned soldier.
    let point: Point | undefined, memberDistance = Infinity, leaderDistance = Infinity;
    for (const candidate of available.values()) {
      const toMember = distance(candidate.point, member), toLeader = candidate.distance;
      if (!point || (toMember - memberDistance || toLeader - leaderDistance) < 0) {
        point = candidate.point; memberDistance = toMember; leaderDistance = toLeader;
      }
    }
    goals.set(member.id, point ?? centered(member));
    if (point) available.delete(key(point));
  }
  return goals;
}

/** Keep named slots while members join, fight or return from a temporary yield.
 * The leader's actual route supplies the column: a turn cannot make the tail
 * cut diagonally through a wall or riverbank. */
export function retinueFormation(state: GameState, leader: Unit): Pick<Formation, 'mode' | 'heading' | 'goals' | 'traveling'> {
  let formation = formations.get(leader);
  if (!formation || formation.state !== state || formation.world !== state.world || state.time < formation.time) {
    formation = { state, world: state.world, time: -1, commands: -1, membersRevision: -1,
      heading: leader.facing, mode: 'mob', previous: { x: leader.x, y: leader.y }, goalAnchor: { x: leader.x, y: leader.y }, trail: [{ x: leader.x, y: leader.y }], slots: new Map(), goals: new Map(), traveling: false, motion: [], rally: {} };
    formations.set(leader, formation);
  }
  const marching = isHumanFaction(state, leader.faction) && movementModeFor(state, leader.faction) === 'formation';
  const commands = decisionRevision(state), membersRevision = entityStore(state).units.revision;
  // Breadcrumb recording and translating an established open-ground layout
  // are movement. Preserve them between the capped membership/obstacle scans.
  if (distance(formation.trail[0], leader) >= .2) formation.trail.unshift({ x: leader.x, y: leader.y });
  if (simulationReadsActive(state) && formation.time >= 0 && state.time + 1e-9 < formation.time + CHECK_INTERVAL) {
    if ((marching || formation.traveling) && formation.mode !== 'column') {
      const dx = leader.x - formation.goalAnchor.x, dy = leader.y - formation.goalAnchor.y;
      if (dx || dy) for (const point of formation.goals.values()) { point.x += dx; point.y += dy; }
    }
    formation.goalAnchor = { x: leader.x, y: leader.y };
    return formation;
  }
  formation.goalAnchor = { x: leader.x, y: leader.y };
  formation.commands = commands; formation.membersRevision = membersRevision; formation.worldRevision = state.world.revision;
  formation.marching = marching;
  formation.time = state.time;
  const wasTraveling = formation.traveling;
  formation.motion.push({ point: { x: leader.x, y: leader.y }, time: state.time });
  while (formation.motion.length > 1 && formation.motion[1].time <= state.time - .6) formation.motion.shift();
  const sample = formation.motion[0], elapsed = state.time - sample.time;
  if (elapsed >= .2) {
    const speed = distance(sample.point, leader) / elapsed;
    // Hysteresis ignores combat shuffling and stale destination orders, while
    // even a slow ford crossing keeps its travel formation.
    if (speed > 1.05) formation.traveling = true;
    else if (speed < .65) formation.traveling = false;
  }
  const dx = leader.x - formation.previous.x, dy = leader.y - formation.previous.y;
  if (Math.hypot(dx, dy) > .025) {
    const direction = Math.atan2(dy, dx);
    // Eight directions match the character artwork. The extra angular margin
    // prevents a tiny sidestep from spinning the whole rank back and forth.
    if (marching) formation.heading = direction;
    else if (Math.abs(angleDifference(direction, formation.heading)) > Math.PI / 8 + .12) formation.heading = Math.round(direction / (Math.PI / 4)) * Math.PI / 4;
    // Accumulate slow movement across frames; ford travel may move less
    // than the heading threshold during every individual render update.
    formation.previous = { x: leader.x, y: leader.y };
  }
  if (distance(formation.trail[0], leader) >= .2) formation.trail.unshift({ x: leader.x, y: leader.y });
  const holdingContact = (unit: Unit): boolean => {
    // Buildings were inserted after units in the former all-world map, so keep
    // that lookup priority while reusing the simulation's existing ID indices.
    const target = unit.target === undefined ? undefined : indexedBuilding(state, unit.target) ?? indexedUnit(state, unit.target);
    if (!target || target.hp <= 0 || state.time - unit.lastCombat >= 1) return false;
    const gap = 'capacity' in target ? Math.hypot(Math.max(target.x - unit.x, 0, unit.x - target.x - buildingWidth(target)),
      Math.max(target.y - unit.y, 0, unit.y - target.y - buildingHeight(target))) : distance(unit, target);
    return gap <= unitAttackRange(state.world, unit, target) + .1;
  };
  const mission = !isHumanFaction(state, leader.faction) && leader.faction > 0 ? getFactionStrategy(state, leader.faction) : undefined;
  const escorts = mission && new Set(mission.escortIds);
  const soldiers = formationRoster(state);
  const members = soldiers.filter(unit => unit.hp > 0 && !unit.inside && unit.faction === leader.faction && isSoldier(unit) && unit.fort === undefined && !unit.garrison && unit.order === 'follow' && unit.marauderPack === undefined
    && (!escorts || unit.joiningRetinue || escorts.has(unit.id))
    && (unit.retinueStance !== 'defensive' || !unit.defensiveAnchor || unit.joiningRetinue || unit.recallIssuedAt !== undefined || unit.forcedAttack)
    // Contact fighters occupy their real position, not an unused rally slot.
    && !holdingContact(unit));
  const present = new Set(soldiers.filter(unit => unit.hp > 0 && unit.faction === leader.faction && isSoldier(unit) && unit.fort === undefined && !unit.garrison
    && (!escorts || unit.joiningRetinue || escorts.has(unit.id))).map(unit => unit.id));
  for (const id of formation.slots.keys()) if (!present.has(id)) formation.slots.delete(id);
  const taken = new Set(formation.slots.values());
  for (const member of members) if (!formation.slots.has(member.id)) {
    let slot = 0; while (taken.has(slot)) slot++;
    formation.slots.set(member.id, slot); taken.add(slot);
  }
  if (!wasTraveling && formation.traveling) {
    // Re-form from the soldiers' current sides when leaving a rally. Keeping
    // pre-rally side assignments makes the rear cross through the whole group.
    const memberIds = new Set(members.map(member => member.id));
    const waiting = [...members], unavailable = new Set([...formation.slots].filter(([id]) => !memberIds.has(id)).map(([, slot]) => slot));
    const side = { x: -Math.sin(formation.heading), y: Math.cos(formation.heading) };
    const forward = { x: Math.cos(formation.heading), y: Math.sin(formation.heading) };
    for (let slot = 0; waiting.length; slot++) {
      if (unavailable.has(slot)) continue;
      const offset = mobOffset(slot), lateral = (slot % 2 ? -1 : 1) * (Math.floor((slot % 6) / 2) + 1) * 1.15;
      const behind = .65 + Math.floor(slot / 6) * 1.2;
      const desired = marching ? { x: leader.x + offset.x, y: leader.y + offset.y }
        : { x: leader.x + side.x * lateral - forward.x * behind, y: leader.y + side.y * lateral - forward.y * behind };
      let nearest = 0, nearestDistance = distance(waiting[0], desired);
      for (let i = 1; i < waiting.length; i++) {
        const d = distance(waiting[i], desired);
        if ((d - nearestDistance || waiting[i].id - waiting[nearest].id) < 0) { nearest = i; nearestDistance = d; }
      }
      formation.slots.set(waiting.splice(nearest, 1)[0].id, slot);
    }
  }
  // Retain enough route for even an unusually large column, then discard old
  // history so ordinary exploration does not grow the save/runtime footprint.
  let trailLength = 0;
  for (let i = 1; i < formation.trail.length; i++) {
    trailLength += distance(formation.trail[i - 1], formation.trail[i]);
    if (trailLength > Math.max(12, members.length * 1.4 + 5)) { formation.trail.length = i + 1; break; }
  }
  const forward = { x: Math.cos(formation.heading), y: Math.sin(formation.heading) };
  const side = { x: -forward.y, y: forward.x };
  const blockers = buildingBlockerView(state, leader.faction);
  if (!formation.traveling) {
    const cell = Math.floor(leader.y) * state.world.width + Math.floor(leader.x);
    const membershipChanged = members.length !== formation.goals.size || members.some(member => !formation!.goals.has(member.id));
    const urgent = wasTraveling || leader.moving || membershipChanged || cell !== formation.rallyCell
      || blockers !== formation.rallyTopology || state.world.revision !== formation.rallyRevision
      || decisionRevision(state) !== formation.rallyCommands;
    const active = state.time - leader.lastCombat < 1 || members.some(member => state.time - member.lastCombat < 1);
    // Walking and contact fighters still update every step. Only the flood
    // fill and assignment of stationary rally cells use the slower clock.
    if (urgent && !simulationReadsActive(state)) formation.rally = {};
    if (decisionDue(formation.rally, state.time, leader.id, active, urgent)) {
      formation.goals = levyWingGoals(leader, members, rallyGoals(state, leader, members, formation.goals, blockers), formation.heading);
      formation.rallyCell = cell; formation.rallyTopology = blockers; formation.rallyRevision = state.world.revision;
      formation.rallyCommands = decisionRevision(state);
    }
    formation.mode = 'mob'; formation.clearSince = undefined;
    return formation;
  }
  const melee = members.filter(member => member.kind !== 'archer').sort((a, b) => formation!.slots.get(a.id)! - formation!.slots.get(b.id)!);
  const ranged = members.filter(member => member.kind === 'archer').sort((a, b) => formation!.slots.get(a.id)! - formation!.slots.get(b.id)!);
  const mixed = melee.length > 0 && ranged.length > 0;
  const roleSlots = new Map([...melee.map((member, index) => [member.id, index] as const), ...ranged.map((member, index) => [member.id, index] as const)]);
  const line = new Map<number, Point>(), reserved = new Set<number>();
  const key = (point: Point) => Math.floor(point.y) * state.world.width + Math.floor(point.x);
  reserved.add(key(leader));
  let fits = true;
  for (const member of members) {
    const slot = formation.slots.get(member.id)!;
    // Keep slots stable through casualties and fights; a new recruit fills the
    // next vacancy without making every other escort cross through the mob.
    const rankSlot = mixed ? roleSlots.get(member.id)! : slot;
    const lateral = (rankSlot % 2 ? -1 : 1) * (Math.floor((rankSlot % 6) / 2) + 1) * 1.15;
    const behind = .65 + (Math.floor(rankSlot / 6) + (mixed && member.kind === 'archer' ? Math.ceil(melee.length / 6) : 0)) * 1.2;
    const offset = mobOffset(slot);
    const desired = marching ? { x: leader.x + offset.x, y: leader.y + offset.y }
      : { x: leader.x + side.x * lateral - forward.x * behind, y: leader.y + side.y * lateral - forward.y * behind };
    let point = marching ? desired : centered(desired);
    // Rounding a diagonal rank can put two ideal slots into one cell. Resolve
    // that cell assignment once for the whole rank, before any unit moves.
    if (reserved.has(key(point))) {
      const alternatives: Point[] = [];
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) alternatives.push({ x: point.x + ox, y: point.y + oy });
      alternatives.sort((a, b) => distance(a, desired) - distance(b, desired));
      point = alternatives.find(candidate => !reserved.has(key(candidate)) && canMove(state, leader, candidate, leader.faction, blockers)) ?? point;
    }
    const ahead = { x: leader.x + forward.x * 1.2, y: leader.y + forward.y * 1.2 };
    const future = { x: point.x + forward.x * 1.2, y: point.y + forward.y * 1.2 };
    if (reserved.has(key(point)) || !canMove(state, leader, point, leader.faction, blockers) || leader.moving && (!canMove(state, point, future, leader.faction, blockers) || !canMove(state, ahead, future, leader.faction, blockers))) {
      // Every line goal is discarded when any slot fails. Later probes cannot
      // restore the width, so proceed directly to the column calculation.
      fits = false; break;
    }
    reserved.add(key(point)); line.set(member.id, point);
  }
  if (fits && members.some(member => member.kind === 'archer') && members.some(member => member.kind === 'warrior' || member.kind === 'spearman' || member.kind === 'horseman')) {
    // Reassign the same reachable cells, putting the ranged rank behind the
    // melee rank in the Leader's actual direction of travel.
    const points = [...line.values()].sort((a, b) => (b.x - a.x) * forward.x + (b.y - a.y) * forward.y
      || (a.x - b.x) * side.x + (a.y - b.y) * side.y);
    const ranked = members.slice().sort((a, b) => Number(a.kind === 'archer') - Number(b.kind === 'archer')
      || formation!.slots.get(a.id)! - formation!.slots.get(b.id)!);
    ranked.forEach((member, index) => line.set(member.id, points[index]));
  }
  if (!fits) { formation.mode = 'column'; formation.clearSince = undefined; }
  else if (formation.mode === 'column') {
    formation.clearSince ??= state.time;
    // Reopen only after a full second of clear width, so
    // alternating wall corners do not repeatedly unfold and refold the group.
    if (state.time - formation.clearSince >= 1) formation.mode = marching ? 'mob' : 'line';
  }
  else formation.mode = marching ? 'mob' : 'line';
  formation.goals = formation.mode !== 'column' ? levyWingGoals(leader, members, line, formation.heading) : new Map();
  if (formation.mode === 'column') {
    const ordered = members.slice().sort((a, b) => Number(a.kind === 'archer') - Number(b.kind === 'archer') || formation!.slots.get(a.id)! - formation!.slots.get(b.id)!);
    const trail = [{ x: leader.x, y: leader.y }, ...formation.trail];
    // Column gaps only increase, including duplicate-cell spacing retries.
    // Walk each breadcrumb segment once instead of starting at the Leader for
    // every soldier. Repeated points (the current Leader sample) have no length.
    let segment = 1, traversed = 0;
    let segmentLength = trail.length > 1 ? distance(trail[0], trail[1]) : 0;
    const trailPoint = (gap: number): Point => {
      let remaining = gap - traversed, point: Point | undefined;
      while (segment < trail.length) {
        if (segmentLength >= remaining && segmentLength > 0) {
          const from = trail[segment - 1], to = trail[segment], ratio = remaining / segmentLength;
          point = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }; break;
        }
        traversed += segmentLength;
        remaining = gap - traversed;
        segment++;
        segmentLength = segment < trail.length ? distance(trail[segment - 1], trail[segment]) : 0;
      }
      if (!point) {
        const end = trail.at(-1)!;
        const extension = { x: end.x - forward.x * remaining, y: end.y - forward.y * remaining };
        // A new/loaded game has no route history. Extend only over real open
        // ground; otherwise queue at the last reachable breadcrumb.
        point = canMove(state, end, extension, leader.faction, blockers) ? extension : end;
      }
      return centered(point);
    };
    const queued = new Set([key(leader)]); let gap = 0;
    for (const member of ordered) {
      gap += 1.15;
      let goal = trailPoint(gap);
      // Diagonal breadcrumbs may round into the preceding soldier's cell.
      // Extend spacing along the same trail instead of competing for that cell.
      for (let attempt = 0; attempt < 8 && queued.has(key(goal)); attempt++) { gap += .25; goal = trailPoint(gap); }
      if (queued.has(key(goal)) || !canWalk(state, goal.x, goal.y, leader.faction, blockers)) goal = centered(member);
      queued.add(key(goal)); formation.goals.set(member.id, goal);
    }
  }
  return formation;
}
