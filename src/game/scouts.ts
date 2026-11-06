import { updateObservationPost } from './observation-posts';
import { CHECK_INTERVAL } from './work-cadence';
import { downhillRangeBonus, unitAttackRange } from './combat-range';
import { isKeep } from './settlement-upgrades';
import { BALLISTA_RANGE } from './ballista';
import { unitSightRadius } from './fog';
import { chooseScoutExplorationRoute, reserveScoutExplorationGoal, type ScoutThreat } from './scout-exploration';
import { unitRespectsForbidden } from './forbidden-zones';
import { canMove, canWalk, createReachabilityQuery } from './pathfinding';
import { highGroundSightMultiplier, sightDistance } from './sight';
import { nearbyBuildings, nearbyUnits } from './spatial';
import { unitPositionBlocked } from './civilian-movement';
import { buildingHeight, buildingReady, buildingWidth, distance, isSoldier, type GameState, type Point, type Unit } from './types';

export const SCOUT_SAFE_SECONDS = 6;
const TAU = Math.PI * 2;
type Move = (state: GameState, unit: Unit, goal: Point, dt: number) => void;
type Hostile = (a: number, b: number) => boolean;
type Threat = ScoutThreat;
interface ScoutPlan {
  goal?: Point; route: Point[]; nextPlan: number; nextScan: number; lastPlan: number;
  threats: Threat[]; avoided: Threat[]; avoidUntil: number; safeAt: number;
  progressAt: number; progress: Point; failed: Map<number, number>; lastTime: number;
}
const plans = new WeakMap<Unit, ScoutPlan>();
const centerCell = (point: Point): Point => ({ x: Math.floor(point.x) + .5, y: Math.floor(point.y) + .5 });
const copy = (point: Point): Point => ({ x: point.x, y: point.y });

/** Scouts use their own sight, never the player's combined fog coverage. */
export function scoutSees(state: GameState, scout: Unit, point: Point): boolean {
  const radius = unitSightRadius(scout) * highGroundSightMultiplier(state.world, scout, point);
  return distance(scout, point) <= radius && sightDistance(state.world, scout, point.x, point.y, radius) <= radius;
}
function observedThreats(state: GameState, scout: Unit, hostile: Hostile): Threat[] {
  const radius = unitSightRadius(scout) * 1.5, threats: Threat[] = [];
  for (const other of nearbyUnits(state, scout, radius)) {
    if (other.hp <= 0 || other.inside || !hostile(scout.faction, other.faction)
      || !(other.kind === 'leader' || isSoldier(other) || other.kind === 'militia') || !scoutSees(state, scout, other)) continue;
    if (other.kind !== 'scout') threats.push({ x: other.x, y: other.y, radius: Math.max(0, unitAttackRange(state.world, other, scout)) + 1 });
  }
  for (const building of nearbyBuildings(state, scout, radius)) {
    if (!buildingReady(building) || !hostile(scout.faction, building.faction)
      || !['tower', 'woodenTower', 'guardPost', 'ballista'].includes(building.kind) && !isKeep(building)) continue;
    const point = { x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 };
    if (scoutSees(state, scout, point)) threats.push({ ...point, radius: building.kind === 'guardPost' ? 3 : (building.kind === 'ballista' ? BALLISTA_RANGE + 1 : 7) + downhillRangeBonus(state.world, point, scout) });
  }
  return threats;
}
function clearJourney(unit: Unit): void {
  unit.path = undefined; unit.pathGoal = undefined; unit.destination = undefined; unit.repathAt = 0;
}
function setGoal(unit: Unit, plan: ScoutPlan, goal: Point | undefined): void {
  if (!goal || !plan.goal || distance(plan.goal, goal) > .75) clearJourney(unit);
  plan.goal = goal;
}
const danger = (point: Point, threats: readonly Threat[]): number => threats.reduce((sum, threat) => sum + Math.max(0, threat.radius - distance(point, threat)), 0);

function sanctuary(state: GameState, scout: Unit): Point | undefined {
  const reachable = createReachabilityQuery(state, scout, scout.faction, undefined, unitRespectsForbidden(state, scout)), candidates: Point[] = [];
  for (const building of state.buildings) {
    if (!['palace', 'scoutLodge'].includes(building.kind) || building.faction !== scout.faction || !buildingReady(building)) continue;
    const w = buildingWidth(building), h = buildingHeight(building);
    for (let dx = -1; dx <= w; dx++) for (let dy = -1; dy <= h; dy++) {
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue;
      const point = { x: building.x + dx + .5, y: building.y + dy + .5 };
      if (reachable(point)) candidates.push(point);
    }
  }
  return candidates.sort((a, b) => distance(scout, a) - distance(scout, b))[0];
}

/** Prefer a clear local escape that increases separation. Do not issue a route
 * to the Leader through the enemies standing between scout and sanctuary. */
function escapeGoal(state: GameState, scout: Unit, home: Point | undefined, threats: readonly Threat[]): Point | undefined {
  const away = threats.reduce((sum, enemy) => {
    const d = Math.max(.25, distance(scout, enemy));
    return { x: sum.x + (scout.x - enemy.x) / (d * d), y: sum.y + (scout.y - enemy.y) / (d * d) };
  }, { x: 0, y: 0 });
  const angle = Math.hypot(away.x, away.y) > 1e-6 ? Math.atan2(away.y, away.x)
    : home ? Math.atan2(home.y - scout.y, home.x - scout.x) : 0;
  const hereDanger = danger(scout, threats), candidates: { point: Point; score: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const a = angle + i * TAU / 16;
    const point = centerCell({ x: scout.x + Math.cos(a) * 2.25, y: scout.y + Math.sin(a) * 2.25 });
    if (distance(scout, point) < .4 || !canMove(state, scout, point, scout.faction, undefined, unitRespectsForbidden(state, scout)) || unitPositionBlocked(state, scout, point)) continue;
    const risk = danger(point, threats);
    // A safe flank is preferable to running straight home through a threat.
    if (risk > hereDanger + .1) continue;
    const fraction = Math.min(1, .5 / distance(scout, point));
    const firstStep = { x: scout.x + (point.x - scout.x) * fraction, y: scout.y + (point.y - scout.y) * fraction };
    if (danger(firstStep, threats) > hereDanger + .01) continue;
    const closest = threats.length ? Math.min(...threats.map(threat => distance(point, threat))) : 0;
    candidates.push({ point, score: risk * 10 + (home ? distance(point, home) * .7 : 0) - Math.min(closest, 12) * .3 });
  }
  return candidates.sort((a, b) => a.score - b.score)[0]?.point;
}
/** Independent noncombat exploration. Expensive destination selection is
 * staggered; ongoing travel keeps a stable frontier instead of orbiting a Leader. */
export function updateScout(state: GameState, scout: Unit, dt: number, move: Move, hostile: Hostile): boolean {
  if (scout.kind !== 'scout' || scout.hp <= 0 || scout.inside) return false;
  if (updateObservationPost(state, scout, dt, move, hostile)) return true;
  scout.moving = false;
  scout.target = undefined; scout.forcedAttack = undefined; scout.attackReturn = undefined; scout.attackTime = 0;
  scout.order = 'follow'; scout.routed = false; scout.routOrder = undefined;
  delete scout.recallIssuedAt; delete scout.recallReturnOrder; delete scout.joiningRetinue;
  let plan = plans.get(scout);
  if (!plan || state.time < plan.lastTime) {
    plan = { route: [], nextPlan: 0, nextScan: 0, lastPlan: -Infinity, threats: [], avoided: [], avoidUntil: -1, safeAt: -1,
      progressAt: state.time, progress: copy(scout), failed: new Map(), lastTime: state.time };
    plans.set(scout, plan);
  }
  plan.lastTime = state.time;
  const clearGoal = () => { setGoal(scout, plan!, undefined); plan!.route = []; reserveScoutExplorationGoal(state, scout); };
  const markFailed = () => {
    if (plan!.goal) plan!.failed.set(Math.floor(plan!.goal.y) * state.world.width + Math.floor(plan!.goal.x), state.time + 20);
    clearGoal(); plan!.nextPlan = state.time + .35;
  };
  if (distance(scout, plan.progress) > .3) { plan.progress = copy(scout); plan.progressAt = state.time; }
  if (state.time + 1e-9 >= plan.nextScan) {
    plan.nextScan = state.time + CHECK_INTERVAL + scout.id % 5 * .025;
    const seen = observedThreats(state, scout, hostile);
    plan.threats = seen;
    if (seen.length) { plan.avoided = seen; plan.avoidUntil = state.time + 25; }
    const remembered = state.time < plan.avoidUntil ? plan.avoided : [];
    if (danger(scout, remembered) > 0 || (scout.lastDamagedAt ?? -100) >= state.time - dt) {
      const justThreatened = state.time >= plan.safeAt;
      plan.safeAt = state.time + SCOUT_SAFE_SECONDS;
      if (justThreatened) { markFailed(); plan.nextPlan = 0; }
    }
  }
  const threats = state.time < plan.avoidUntil ? plan.avoided : [];
  const moveSafely = (goal: Point) => {
    const next = scout.path?.find(point => distance(scout, point) > .15) ?? goal;
    const length = distance(scout, next), step = Math.min(length, scout.speed * Math.max(dt, .25));
    const probe = length ? { x: scout.x + (next.x - scout.x) * step / length, y: scout.y + (next.y - scout.y) * step / length } : scout;
    if (danger(probe, threats) > danger(scout, threats) + .01) { markFailed(); return; }
    move(state, scout, goal, dt);
  };
  if (state.time < plan.safeAt) {
    if (threats.length && danger(scout, threats) <= 0) { clearGoal(); return true; }
    if (state.time + 1e-9 >= plan.lastPlan + CHECK_INTERVAL && (state.time >= plan.nextPlan || plan.goal && distance(scout, plan.goal) < .4)) {
      plan.lastPlan = state.time;
      setGoal(scout, plan, escapeGoal(state, scout, sanctuary(state, scout), threats));
      plan.nextPlan = state.time + .4 + scout.id % 3 * .04;
    }
    if (plan.goal) moveSafely(plan.goal);
    return true;
  }
  // A completed evasive step is never leased as an exploration destination.
  if (plan.safeAt >= 0) { plan.safeAt = -1; clearGoal(); plan.nextPlan = 0; }
  if (plan.goal && distance(scout, plan.goal) < .4) { clearGoal(); plan.nextPlan = 0; }
  if (plan.goal && state.time - plan.progressAt > 3) markFailed();
  if (state.time >= plan.nextPlan && state.time + 1e-9 >= plan.lastPlan + CHECK_INTERVAL) {
    plan.lastPlan = state.time;
    for (const [cell, until] of plan.failed) if (until <= state.time) plan.failed.delete(cell);
    if (plan.goal && !canWalk(state, plan.goal.x, plan.goal.y, scout.faction, undefined, unitRespectsForbidden(state, scout))) clearGoal();
    if (!plan.goal) {
      const route = chooseScoutExplorationRoute(state, scout, plan.failed, threats);
      setGoal(scout, plan, route?.goal); plan.route = route?.path ?? [];
      plan.progress = copy(scout); plan.progressAt = state.time;
    }
    plan.nextPlan = state.time + (plan.goal ? 1.25 : 3) + scout.id % 7 * .035;
  }
  if (plan.goal) {
    reserveScoutExplorationGoal(state, scout, plan.goal);
    if (threats.length) {
      // Follow the safe route's local legs. Ordinary navigation must not replace
      // a flank around an enemy with its own shorter route through weapon reach.
      while (plan.route.length && distance(scout, plan.route[0]) < .45) plan.route.shift();
      const next = plan.route[0];
      if (!next) markFailed(); else moveSafely(next);
    } else moveSafely(plan.goal);
  }
  return true;
}
