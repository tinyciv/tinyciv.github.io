import { decisionDue, type DecisionClock } from './decision-schedule';
import { simulationReadsActive } from './simulation-reads';
import { CHECK_INTERVAL } from './work-cadence';
import { spendGold } from './gold-ledger';
import { maximumUnitRange, unitAttackRange } from './combat-range';
import { constructionEdges } from './builders';
import { canMove, canWalk, travelTimeMap } from './pathfinding';
import { indexedBuilding, nearbyBuildings, nearbyUnits } from './spatial';
import { sightDistance } from './sight';
import { WOODEN_TOWER_RANGE } from './tower-combat';
import { isRaidObjective, isRaiderEnemyFaction } from './raid-targeting';
import { isKeep } from './settlement-upgrades';
import { buildingReady, buildingWidth, buildingHeight, distance, isFarmKind, isSoldier, isWallKind, type Building, type GameState, type MarauderPack, type Point, type Unit } from './types';

export type RaiderMotivation = NonNullable<MarauderPack['motivation']>;
export const SIEGE_REINFORCEMENT_SECONDS = 15;
export const SIEGE_REINFORCEMENT_SIZE = 5;
export const SIEGE_HOLD_SECONDS = 30;
export const SIEGE_MAX_HOLD_SECONDS = 90;
const RAIDER_FACTION = -2;
const center = (building: Building): Point => ({ x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 });
const edgeDistance = (point: Point, building: Building): number => Math.hypot(Math.max(building.x - point.x, 0, point.x - building.x - buildingWidth(building)),
  Math.max(building.y - point.y, 0, point.y - building.y - buildingHeight(building)));
const military = (unit: Unit): boolean => unit.kind === 'leader' || unit.kind === 'militia' || isSoldier(unit);
const person = (unit: Unit): boolean => military(unit) || unit.kind === 'worker' || unit.kind === 'merchant';
const hostile = (state: GameState, unit: Unit): boolean => isRaiderEnemyFaction(state, unit.faction) && unit.hp > 0 && !unit.inside && person(unit);
const clearJourney = (unit: Unit): void => {
  unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
};

/** Early raids keep the original assault. Later small harassment/theft parties
 * alternate with assaults, and only one wave in eight attempts a siege. */
export function raiderMotivationForWave(waves: number): RaiderMotivation {
  return (['assault', 'assault', 'harass', 'assault', 'theft', 'assault', 'harass', 'siege'] as const)[Math.max(0, Math.floor(waves)) % 8];
}
export function raiderMotivationSize(motivation: RaiderMotivation, ordinary: number, defendingSoldiers: number): { initial: number; total: number } {
  if (motivation === 'harass') { const total = Math.min(10, Math.max(2, Math.round(ordinary / 3))); return { initial: total, total }; }
  if (motivation === 'theft') { const total = Math.min(10, Math.max(1, 1 + Math.ceil(Math.max(0, defendingSoldiers) / 5))); return { initial: total, total }; }
  if (motivation === 'siege') { const total = Math.min(30, Math.max(10, 10 + Math.ceil(Math.max(0, defendingSoldiers) / 2))); return { initial: Math.min(10, total), total }; }
  return { initial: ordinary, total: ordinary };
}

/** Theft uses real weighted travel times without deleting walls from planning.
 * A fully closed city is never selected as a supposedly open theft route. */
export function selectTheftPalace(state: GameState, from: Point, faction?: number): { palace: Building; entrance: Point } | undefined {
  const palaces = state.buildings.filter(building => building.kind === 'palace' && !isKeep(building) && isRaiderEnemyFaction(state, building.faction) && buildingReady(building)
    && (faction === undefined || building.faction === faction)
    && !state.factions.find(candidate => candidate.id === building.faction)?.defeated);
  if (!palaces.length) return;
  const travel = travelTimeMap(state, from, RAIDER_FACTION, 2.35, Infinity);
  let result: { palace: Building; entrance: Point } | undefined, best = Infinity;
  for (const palace of palaces) for (const entrance of constructionEdges(state, palace)) {
    if (!canWalk(state, entrance.x, entrance.y, RAIDER_FACTION)) continue;
    const cost = travel[Math.floor(entrance.y) * state.world.width + Math.floor(entrance.x)];
    if (cost < best) { best = cost; result = { palace, entrance }; }
  }
  return result;
}
function returnHome(pack: MarauderPack, members: readonly Unit[]): void {
  if (!pack.returning) for (const member of members) clearJourney(member);
  pack.returning = true; pack.phase = 'escape'; pack.waypoint = { ...pack.home };
  delete pack.siegeNextReinforceAt;
}

interface GroupCache { time: number; groups: Map<number, readonly Unit[]> }
const groupFrames = new WeakMap<GameState, GroupCache>();
const nextGroupPlans = new WeakMap<MarauderPack, number>();
interface DefenseCache { until: number; byFaction: Map<number, { point: Point; radius: number }[]> }
const defenseFrames = new WeakMap<GameState, DefenseCache>();
function rememberGroup(state: GameState, pack: MarauderPack, members: readonly Unit[]): void {
  let frame = groupFrames.get(state);
  if (!frame || frame.time !== state.time) { frame = { time: state.time, groups: new Map() }; groupFrames.set(state, frame); }
  frame.groups.set(pack.id, members);
}
function groupMembers(state: GameState, pack: MarauderPack): readonly Unit[] {
  let frame = groupFrames.get(state);
  if (!simulationReadsActive(state)) return frame?.time === state.time && frame.groups.get(pack.id)
    || state.units.filter(unit => unit.hp > 0 && unit.marauderPack === pack.id);
  if (!frame || state.time < frame.time || state.time + 1e-9 >= frame.time + CHECK_INTERVAL) {
    const groups = new Map<number, Unit[]>();
    for (const unit of state.units) if (unit.hp > 0 && unit.marauderPack !== undefined) {
      const members = groups.get(unit.marauderPack) ?? [];
      members.push(unit); groups.set(unit.marauderPack, members);
    }
    frame = { time: state.time, groups }; groupFrames.set(state, frame);
  }
  return frame.groups.get(pack.id) ?? [];
}
function seenMilitary(state: GameState, members: readonly Unit[]): Unit | undefined {
  for (const member of members) for (const enemy of nearbyUnits(state, member, 7))
    if (hostile(state, enemy) && military(enemy) && distance(member, enemy) <= 7 && sightDistance(state.world, member, enemy.x, enemy.y, 7) <= 7) return enemy;
  return undefined;
}
function dangerousDefenses(state: GameState, faction: number): { point: Point; radius: number }[] {
  let cache = defenseFrames.get(state);
  if (!cache || state.time >= cache.until) { cache = { until: state.time + .5, byFaction: new Map() }; defenseFrames.set(state, cache); }
  const known = cache.byFaction.get(faction);
  if (known) return known;
  const defenses: { point: Point; radius: number }[] = [];
  for (const building of state.buildings) if (building.faction === faction && buildingReady(building)
    && (building.kind === 'woodenTower' || building.kind === 'tower' || isKeep(building))) defenses.push({ point: center(building), radius: WOODEN_TOWER_RANGE + 2 });
  for (const unit of state.units) if (unit.faction === faction && unit.hp > 0 && !unit.inside && military(unit) && unit.range > 1.5)
    defenses.push({ point: unit, radius: unit.range + 2 });
  cache.byFaction.set(faction, defenses);
  return defenses;
}
function safeSpot(point: Point, defenses: readonly { point: Point; radius: number }[]): boolean {
  return defenses.every(defense => distance(point, defense.point) > defense.radius);
}
/** Select one reachable assembly site outside every known firing radius. */
export function siegeRallyPoint(state: GameState, from: Point, target: Building): Point | undefined {
  const travel = travelTimeMap(state, from, RAIDER_FACTION, 2.35, Infinity), goal = center(target);
  const defenses = dangerousDefenses(state, target.faction);
  let best = Infinity, result: Point | undefined;
  for (let y = Math.max(0, Math.floor(goal.y - 22)); y < Math.min(state.world.height, goal.y + 22); y++)
    for (let x = Math.max(0, Math.floor(goal.x - 22)); x < Math.min(state.world.width, goal.x + 22); x++) {
      const point = { x: x + .5, y: y + .5 }, d = distance(point, goal);
      if (d < 10 || d > 22 || !safeSpot(point, defenses)) continue;
      const cost = travel[y * state.world.width + x];
      const score = cost + Math.abs(d - 12) * .6;
      if (score < best) { best = score; result = point; }
    }
  return result;
}
function campHouse(state: GameState, pack: MarauderPack, from: Point): Building | undefined {
  const camp = state.raiderCamps?.find(camp => camp.id === pack.raiderCamp);
  return (camp?.houses ?? []).map(id => indexedBuilding(state, id)).filter((building): building is Building => !!building
    && building.faction === RAIDER_FACTION && building.kind === 'house' && buildingReady(building))
    .sort((a, b) => edgeDistance(from, a) - edgeDistance(from, b))[0];
}
function finishLootReturn(state: GameState, pack: MarauderPack, members: readonly Unit[]): void {
  for (const carrier of members) if ((carrier.stolenGold ?? 0) > 0) {
    const house = campHouse(state, pack, carrier);
    if (house && edgeDistance(carrier, house) <= .8) carrier.stolenGold = 0;
  }
}

/** Called once per pack before default raid planning. Return true to keep the
 * default assault logic from overwriting a specialist's goal or muster stage. */
export function updateRaiderGroupMotivation(state: GameState, pack: MarauderPack, members: readonly Unit[]): boolean {
  if (!pack.motivation || pack.motivation === 'assault') return false;
  rememberGroup(state, pack, members);
  if (!members.length) return true;
  const origin = members.find(unit => unit.id === pack.leaderId) ?? members[0];
  if (!pack.returning && members.length <= Math.floor(((pack.startingTroops ?? members.length - 1) + 1) * .3)) returnHome(pack, members);
  if (pack.returning || pack.phase === 'escape') { returnHome(pack, members); finishLootReturn(state, pack, members); return true; }
  if (state.time < (nextGroupPlans.get(pack) ?? -Infinity)) return true;
  nextGroupPlans.set(pack, state.time + .5);
  if (pack.motivation === 'harass') {
    if (seenMilitary(state, members)) returnHome(pack, members);
    else {
      const target = state.buildings.find(building => building.id === pack.targetBuilding && buildingReady(building) && building.faction === pack.targetFaction && isRaidObjective(state, building));
      if (target) pack.waypoint = center(target); else returnHome(pack, members);
    }
    return true;
  }
  if (pack.motivation === 'theft') {
    if (pack.raidObjectiveDone) { returnHome(pack, members); return true; }
    if (state.time < (pack.nextMotivationAt ?? 0)) return true;
    pack.nextMotivationAt = state.time + 3;
    // An entrance may remain walkable while a newly completed wall cuts its
    // route off. Recheck real reachability, not just the destination tile.
    const choice = selectTheftPalace(state, origin, pack.targetFaction) ?? selectTheftPalace(state, origin);
    if (!choice) { returnHome(pack, members); return true; }
    if (pack.targetBuilding !== choice.palace.id || !pack.raidGoal || distance(pack.raidGoal, choice.entrance) > .1)
      for (const member of members) clearJourney(member);
    pack.targetBuilding = choice.palace.id; pack.targetFaction = choice.palace.faction; pack.raidGoal = choice.entrance;
    pack.waypoint = { ...pack.raidGoal! }; return true;
  }
  const target = state.buildings.find(building => building.id === pack.targetBuilding && buildingReady(building) && building.faction === pack.targetFaction && isRaidObjective(state, building));
  if (!target) { returnHome(pack, members); return true; }
  if (!pack.rally || pack.phase !== 'attack' && (!canWalk(state, pack.rally.x, pack.rally.y, RAIDER_FACTION) || !safeSpot(pack.rally, dangerousDefenses(state, target.faction)))) {
    pack.rally = siegeRallyPoint(state, origin, target);
    if (!pack.rally) { returnHome(pack, members); return true; }
    pack.phase = 'approach'; delete pack.musterStartedAt; delete pack.musterUntil;
  }
  if (pack.phase !== 'attack') {
    pack.waypoint = pack.rally;
    if (pack.musterStartedAt === undefined && members.some(unit => distance(unit, pack.rally!) < 3)) {
      pack.musterStartedAt = state.time; pack.musterUntil = state.time + SIEGE_HOLD_SECONDS; pack.phase = 'muster';
    }
    const assembled = members.filter(unit => distance(unit, pack.rally!) <= 4).length;
    if (pack.musterUntil !== undefined && state.time >= pack.musterUntil
      && (members.length >= (pack.musterTarget ?? 10) && assembled >= Math.ceil(members.length * .6)
        || state.time >= pack.musterStartedAt! + SIEGE_MAX_HOLD_SECONDS)) {
      if (members.length < 10) returnHome(pack, members);
      else { pack.phase = 'attack'; pack.waypoint = center(target); delete pack.siegeNextReinforceAt; for (const member of members) clearJourney(member); }
    }
  } else pack.waypoint = center(target);
  return true;
}

export interface RaiderMotivationOrders {
  move: (unit: Unit, goal: Point, dt: number) => void;
  attack: (unit: Unit, target: Unit | Building, dt: number) => void;
  visible: (unit: Unit, target: Unit | Building) => boolean;
}
function blockingEnemy(state: GameState, unit: Unit, goal: Point, orders: RaiderMotivationOrders): Unit | undefined {
  const dx = goal.x - unit.x, dy = goal.y - unit.y, length = Math.hypot(dx, dy) || 1;
  return nearbyUnits(state, unit, 1.6).filter(enemy => {
    if (!hostile(state, enemy) || !orders.visible(unit, enemy) || distance(unit, enemy) > 1.6
      || !canMove(state, unit, enemy, unit.faction)) return false;
    const ex = enemy.x - unit.x, ey = enemy.y - unit.y;
    return ex * dx + ey * dy > 0 && Math.abs(ex * dy - ey * dx) / length < .7;
  }).sort((a, b) => distance(a, unit) - distance(b, unit))[0];
}
function returnUnit(state: GameState, pack: MarauderPack, unit: Unit, dt: number, orders: RaiderMotivationOrders): void {
  unit.target = undefined;
  let goal = pack.home;
  if ((unit.stolenGold ?? 0) > 0) {
    const house = campHouse(state, pack, unit);
    if (house) {
      if (edgeDistance(unit, house) <= .8) { unit.stolenGold = 0; return; }
      goal = constructionEdges(state, house).filter(point => canWalk(state, point.x, point.y, RAIDER_FACTION))
        .sort((a, b) => distance(a, unit) - distance(b, unit))[0] ?? goal;
    }
  }
  if (pack.motivation === 'theft') {
    const blocker = blockingEnemy(state, unit, goal, orders);
    if (blocker) { orders.attack(unit, blocker, dt); return; }
  }
  if (distance(unit, goal) > .6) orders.move(unit, goal, dt);
}
function theftUnit(state: GameState, pack: MarauderPack, unit: Unit, dt: number, orders: RaiderMotivationOrders): void {
  const palace = indexedBuilding(state, pack.targetBuilding);
  if (!palace || palace.kind !== 'palace' || !buildingReady(palace) || !pack.raidGoal) return;
  if (isKeep(palace)) { returnHome(pack, groupMembers(state, pack)); returnUnit(state, pack, unit, dt, orders); return; }
  const faction = state.factions.find(candidate => candidate.id === palace.faction);
  if (!pack.raidObjectiveDone && edgeDistance(unit, palace) <= .8) {
    const amount = Math.min(Math.max(0, faction?.gold ?? 0), Math.max(200, (faction?.gold ?? 0) / 2));
    if (faction) spendGold(state, faction, amount, 'raided');
    unit.stolenGold = (unit.stolenGold ?? 0) + amount;
    pack.lootCarrier = unit.id; pack.raidObjectiveDone = true;
    if (amount) state.particles.push({ ...center(palace), text: `−${Math.round(amount)} gold`, color: '#f46b63', life: 1.8 });
    returnHome(pack, groupMembers(state, pack)); return;
  }
  const nearby = nearbyUnits(state, unit, 4).filter(enemy => hostile(state, enemy) && distance(enemy, unit) <= 4 && orders.visible(unit, enemy));
  const allies = groupMembers(state, pack).filter(member => member.hp > 0 && distance(member, unit) <= 4).length;
  const blocker = blockingEnemy(state, unit, pack.raidGoal, orders);
  const advantage = nearby.length > 0 && allies >= nearby.length * 3;
  const target = blocker ?? (advantage ? nearby.filter(enemy => canMove(state, unit, enemy, unit.faction)).sort((a, b) => distance(a, unit) - distance(b, unit))[0] : undefined);
  if (target) orders.attack(unit, target, dt);
  else { unit.target = undefined; orders.move(unit, pack.raidGoal, dt); }
}

/** Return false for the original assault behavior, including a siege released
 * from muster; specialists otherwise suppress indiscriminate attack-move. */
type MotivationAction = { kind: 'move'; goal: Point } | { kind: 'attack'; target: Unit | Building };
interface MotivationPlan extends DecisionClock { handled: boolean; action?: MotivationAction; pack?: MarauderPack; returning?: boolean }
const motivationPlans = new WeakMap<Unit, MotivationPlan>();
export function updateRaiderMotivation(state: GameState, unit: Unit, dt: number, orders: RaiderMotivationOrders): boolean {
  if (!simulationReadsActive(state)) return planRaiderMotivation(state, unit, dt, orders);
  let plan = motivationPlans.get(unit);
  if (!plan) { plan = { handled: false }; motivationPlans.set(unit, plan); }
  if (decisionDue(plan, state.time, unit.id)) {
    plan.pack = state.marauderPacks?.find(pack => pack.id === unit.marauderPack);
    plan.action = undefined;
    plan.handled = planRaiderMotivation(state, unit, dt, {
      ...orders,
      move: (moving, goal, elapsed) => { plan!.action = { kind: 'move', goal }; orders.move(moving, goal, elapsed); },
      attack: (attacker, target, elapsed) => { plan!.action = { kind: 'attack', target }; orders.attack(attacker, target, elapsed); },
    });
    plan.returning = plan.pack?.returning || plan.pack?.phase === 'escape';
    return plan.handled;
  }
  if (!plan.handled) return false;
  if (!plan.returning && (plan.pack?.returning || plan.pack?.phase === 'escape')) {
    unit.target = undefined;
    if (distance(unit, plan.pack.home) > .6) orders.move(unit, plan.pack.home, dt);
    return true;
  }
  const action = plan.action;
  if (action?.kind === 'move') orders.move(unit, action.goal, dt);
  else if (action?.kind === 'attack' && action.target.hp > 0 && isRaiderEnemyFaction(state, action.target.faction)
    && ('capacity' in action.target || !action.target.inside)) orders.attack(unit, action.target, dt);
  else unit.target = undefined;
  return true;
}
function planRaiderMotivation(state: GameState, unit: Unit, dt: number, orders: RaiderMotivationOrders): boolean {
  const pack = state.marauderPacks?.find(candidate => candidate.id === unit.marauderPack);
  if (!pack?.motivation || pack.motivation === 'assault') return false;
  const members = groupMembers(state, pack);
  if (pack.returning || pack.phase === 'escape') { returnUnit(state, pack, unit, dt, orders); return true; }
  if (pack.motivation === 'theft') { theftUnit(state, pack, unit, dt, orders); return true; }
  if (pack.motivation === 'siege') {
    if (pack.phase === 'attack') return false;
    if (!pack.rally) return true;
    const defenses = dangerousDefenses(state, pack.targetFaction);
    const index = Math.max(0, members.indexOf(unit));
    const desired = { x: pack.rally.x + index % 5 - 2, y: pack.rally.y + Math.floor(index / 5) - 2 };
    const goal = canWalk(state, desired.x, desired.y, unit.faction) && safeSpot(desired, defenses) ? desired : pack.rally;
    const enemy = nearbyUnits(state, unit, Math.max(1.3, maximumUnitRange(unit))).find(candidate => hostile(state, candidate)
      && distance(candidate, unit) <= unitAttackRange(state.world, unit, candidate) && orders.visible(unit, candidate));
    if (enemy) orders.attack(unit, enemy, dt);
    else if (distance(unit, goal) > .3) { unit.target = undefined; orders.move(unit, goal, dt); }
    return true;
  }
  const militaryThreat = nearbyUnits(state, unit, 7).find(enemy => hostile(state, enemy) && military(enemy) && distance(unit, enemy) <= 7 && orders.visible(unit, enemy));
  if (militaryThreat) { returnHome(pack, members); returnUnit(state, pack, unit, dt, orders); return true; }
  const victim = nearbyUnits(state, unit, 8).filter(enemy => hostile(state, enemy) && !military(enemy) && distance(enemy, unit) <= 8 && orders.visible(unit, enemy))
    .sort((a, b) => distance(a, unit) - distance(b, unit))[0];
  if (victim) { orders.attack(unit, victim, dt); return true; }
  const target = nearbyBuildings(state, unit, 9).filter(building => isRaiderEnemyFaction(state, building.faction) && buildingReady(building) && !isFarmKind(building.kind) && !isWallKind(building.kind)
    && !['road', 'bridge', 'irrigation', 'ruin', 'woodenTower', 'tower', 'guardPost'].includes(building.kind)
    && safeSpot(center(building), dangerousDefenses(state, building.faction)) && edgeDistance(unit, building) <= 7 && orders.visible(unit, building)
    && !nearbyUnits(state, center(building), 6).some(enemy => hostile(state, enemy) && military(enemy) && distance(enemy, center(building)) <= 6))
    .sort((a, b) => edgeDistance(unit, a) - edgeDistance(unit, b))[0];
  if (target) orders.attack(unit, target, dt);
  else if (distance(unit, pack.waypoint) > 1) { unit.target = undefined; orders.move(unit, pack.waypoint, dt); }
  return true;
}
