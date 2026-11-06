import { simulationReadsActive } from './simulation-reads';
import { decisionDue, type DecisionClock } from './decision-schedule';
import { constructionEdges } from './builders';
import { buildingWorkForbidden } from './forbidden-work';
import { unitAttackRange } from './combat-range';
import { entityStore } from './entity-store';
import { spendGold } from './gold-ledger';
import { canMove, canWalk, hasStaticPath, invalidateNavigation } from './pathfinding';
import { playerFaction } from './player-context';
import { indexedBuilding, nearbyUnits } from './spatial';
import { queueConstruction } from './structures';
import { invalidateSettlementDecisions } from './settlement-decisions';
import { buildingHeight, buildingReady, buildingWidth, distance, type Building, type Faction, type GameState, type Point, type Unit } from './types';
import { markWorldChanged } from './world-revisions';

export const FORT_GOLD = 300;
/** The masonry layout multiplier is applied by wall-stats, exactly as for walls. */
export const FORT_BASE_HP = 225;
export const FORT_BUILD_SECONDS = 60;
export const FORT_UPKEEP = 20;
export const FORT_UPKEEP_INTERVAL = 30;
export const FORT_BRIGADE_CAPACITIES = [0, 3, 6, 10] as const;
export const FORT_BRIGADE_COSTS = [150, 200, 300] as const;
export const SKIRMISHER_PATROL_RADIUS = 12;
export const SKIRMISHER_RETREAT_RADIUS = 3;
export const SKIRMISHER_HP = 70;
export const SKIRMISHER_ATTACK = 14;
export const SKIRMISHER_DEFENSE = 2;
export const SKIRMISHER_SPEED = 4.2;
export const SKIRMISHER_RANGE = 5;
const center = (fort: Building): Point => ({ x: fort.x + buildingWidth(fort) / 2, y: fort.y + buildingHeight(fort) / 2 });
export const fortBrigadeLevel = (fort: Building): 0 | 1 | 2 | 3 => Math.max(0, Math.min(3, Math.floor(fort.fort?.brigadeLevel ?? 0))) as 0 | 1 | 2 | 3;
export const fortBrigadeCapacity = (fort: Building): number => FORT_BRIGADE_CAPACITIES[fortBrigadeLevel(fort)];
export const fortUpkeep = (fort: Building): number => fort.kind === 'fort' && buildingReady(fort) && fort.fort?.funded !== false ? FORT_UPKEEP : 0;
function fortState(state: GameState, fort: Building): NonNullable<Building['fort']> {
  return fort.fort ??= { brigadeLevel: 0, nextUpkeepAt: state.time + FORT_UPKEEP_INTERVAL, funded: true,
    nextRecruitAt: state.time, initialGold: fort.construction?.paidGold ?? FORT_GOLD };
}
function leaderNearby(state: GameState, fort: Building): boolean {
  const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === fort.faction && unit.hp > 0 && !unit.inside);
  return !!leader && Math.hypot(Math.max(fort.x - leader.x, 0, leader.x - fort.x - buildingWidth(fort)),
    Math.max(fort.y - leader.y, 0, leader.y - fort.y - buildingHeight(fort))) <= 3;
}
function ownedFortReason(state: GameState, fort: Building): string {
  const faction = state.factions.find(owner => owner.id === fort.faction);
  if (state.gameOver || faction?.defeated) return 'Your realm can no longer improve forts.';
  if (fort.kind !== 'fort' || fort.faction !== playerFaction(state) || !faction || !state.buildings.includes(fort)) return 'Choose your own Fort.';
  if (!leaderNearby(state, fort)) return 'Move your Leader within 3 tiles of the Fort.';
  return '';
}
export function upgradeFortBrigadeStatus(state: GameState, fort: Building): { capacity: number; nextCapacity: number | null; cost: number | null; available: boolean; reason: string } {
  const level = fortBrigadeLevel(fort), capacity = fortBrigadeCapacity(fort);
  const nextCapacity = level < 3 ? FORT_BRIGADE_CAPACITIES[level + 1] : null;
  const cost = level < 3 ? FORT_BRIGADE_COSTS[level as 0 | 1 | 2] : null;
  let reason = ownedFortReason(state, fort);
  if (!reason && !buildingReady(fort)) reason = 'Complete or rebuild the Fort first.';
  if (!reason && nextCapacity === null) reason = 'Skirmisher Brigade fully upgraded.';
  if (!reason && state.factions.find(owner => owner.id === fort.faction)!.gold < cost!) reason = `Need ${cost} gold.`;
  return { capacity, nextCapacity, cost, available: !reason, reason };
}
export function upgradeFortBrigade(state: GameState, fort: Building): { ok: boolean; message: string } {
  const status = upgradeFortBrigadeStatus(state, fort);
  if (!status.available) return { ok: false, message: status.reason };
  spendGold(state, state.factions.find(owner => owner.id === fort.faction)!, status.cost!, 'upgrades');
  const data = fortState(state, fort);
  data.brigadeLevel = (fortBrigadeLevel(fort) + 1) as 1 | 2 | 3;
  data.nextRecruitAt = state.time;
  return { ok: true, message: `Skirmisher Brigade expanded to ${status.nextCapacity} patrols.` };
}
export function rebuildFortStatus(state: GameState, fort: Building): { cost: number; available: boolean; reason: string } {
  const cost = (fort.fort?.initialGold ?? FORT_GOLD) / 2;
  let reason = ownedFortReason(state, fort);
  if (!reason && (fort.hp > 0 || fort.construction || !fort.fort?.destroyed)) reason = 'This Fort does not need rebuilding.';
  if (!reason && buildingWorkForbidden(state, fort)) reason = 'Remove the forbidden zone before rebuilding here.';
  if (!reason && state.factions.find(owner => owner.id === fort.faction)!.gold < cost) reason = `Need ${cost} gold.`;
  if (!reason && state.buildings.some(other => other !== fort && other.hp > 0 && other.kind !== 'road'
    && other.x < fort.x + buildingWidth(fort) && other.x + buildingWidth(other) > fort.x
    && other.y < fort.y + buildingHeight(fort) && other.y + buildingHeight(other) > fort.y)) reason = 'Clear the Fort foundations before rebuilding.';
  return { cost, available: !reason, reason };
}
export function rebuildFort(state: GameState, fort: Building): { ok: boolean; message: string } {
  const status = rebuildFortStatus(state, fort);
  if (!status.available) return { ok: false, message: status.reason };
  spendGold(state, state.factions.find(owner => owner.id === fort.faction)!, status.cost, 'construction');
  const data = fortState(state, fort);
  data.destroyed = false; data.funded = false; data.nextUpkeepAt = -1;
  fort.hp = fort.maxHp;
  queueConstruction(fort, state.time, status.cost, state);
  invalidateNavigation(state); markWorldChanged(state.world); invalidateSettlementDecisions(state);
  return { ok: true, message: `Fort rebuilding ordered for ${status.cost} gold. The Skirmisher Brigade upgrade is preserved.` };
}
/** The footprint and original owner survive combat destruction; only the owner
 * can remove the foundations. It is no longer a target, obstacle or border source. */
export function preserveDestroyedFort(state: GameState, fort: Building): boolean {
  if (fort.kind !== 'fort' || fort.hp > 0) return false;
  const data = fortState(state, fort);
  data.destroyed = true; data.funded = false;
  delete fort.construction; delete fort.repairerId;
  fort.attackCooldown = 0;
  entityStore(state).buildings.updateRoles(fort);
  for (const unit of state.units) if (unit.fort === fort.id) { unit.hp = 0; unit.inside = true; unit.target = undefined; }
  invalidateNavigation(state); markWorldChanged(state.world);
  return true;
}
function collectUpkeep(state: GameState, fort: Building, faction: Faction): void {
  const data = fortState(state, fort);
  while (state.time + 1e-7 >= data.nextUpkeepAt) {
    if (faction.gold + 1e-7 < FORT_UPKEEP) { data.funded = false; return; }
    spendGold(state, faction, Math.min(FORT_UPKEEP, Math.max(0, faction.gold)), 'defenses');
    data.nextUpkeepAt = (data.funded ? data.nextUpkeepAt : state.time) + FORT_UPKEEP_INTERVAL;
    data.funded = true;
  }
}
function makeSkirmisher(state: GameState, fort: Building, point: Point, id: number): Unit {
  const owner = state.factions.find(faction => faction.id === fort.faction);
  return entityStore(state).units.add({ id, kind: 'skirmisher', faction: fort.faction, fort: fort.id, home: fort.id,
    ...point, hp: SKIRMISHER_HP, maxHp: SKIRMISHER_HP, morale: 100, attack: SKIRMISHER_ATTACK, defense: SKIRMISHER_DEFENSE,
    speed: SKIRMISHER_SPEED, range: SKIRMISHER_RANGE, order: 'wander', cooldown: 0, lastCombat: -60,
    moving: false, facing: 0, attackTime: 0, bornAt: state.time, armorLevel: owner?.armorLevel ?? 0, weaponLevel: owner?.weaponLevel ?? 0 });
}
/** Brigade losses are replaced at most once per paid upkeep interval. Skirmishers
 * are a Fort garrison and never occupy the Leader's retinue or population slots. */
export function updateForts(state: GameState): void {
  const factions = new Map(state.factions.map(faction => [faction.id, faction]));
  const forts = new Map(state.buildings.filter(building => building.kind === 'fort').map(fort => [fort.id, fort]));
  const rosters = new Map<number, Unit[]>();
  let nextId = 1;
  for (const building of state.buildings) nextId = Math.max(nextId, building.id + 1);
  for (const unit of state.units) {
    nextId = Math.max(nextId, unit.id + 1);
    if (unit.kind !== 'skirmisher' || unit.hp <= 0) continue;
    const fort = forts.get(unit.fort ?? -1), faction = fort && factions.get(fort.faction);
    if (!fort || fort.hp <= 0 || fort.faction !== unit.faction || faction?.defeated) { unit.hp = 0; unit.inside = true; continue; }
    const roster = rosters.get(fort.id) ?? []; roster.push(unit); rosters.set(fort.id, roster);
    unit.armorLevel = faction?.armorLevel ?? 0; unit.weaponLevel = faction?.weaponLevel ?? 0;
  }
  for (const fort of forts.values()) {
    if (fort.hp <= 0) { if (!fort.fort?.destroyed) preserveDestroyedFort(state, fort); continue; }
    if (!buildingReady(fort)) continue;
    const faction = factions.get(fort.faction);
    if (!faction || faction.defeated) continue;
    const data = fortState(state, fort);
    // Reconstruction includes its first completed interval, never the builder's travel time.
    if (data.nextUpkeepAt < 0) { data.nextUpkeepAt = state.time + FORT_UPKEEP_INTERVAL; data.funded = true; }
    collectUpkeep(state, fort, faction);
    if (!data.funded || state.time < data.nextRecruitAt) continue;
    const roster = rosters.get(fort.id) ?? [], needed = fortBrigadeCapacity(fort) - roster.length;
    if (needed <= 0) continue;
    const exits = constructionEdges(state, fort, true).filter(point => !state.units.some(unit => unit.hp > 0 && !unit.inside && distance(point, unit) < .5));
    const count = Math.min(needed, exits.length);
    for (let i = 0; i < count; i++) makeSkirmisher(state, fort, exits[i], nextId++);
    data.nextRecruitAt = state.time + (count ? FORT_UPKEEP_INTERVAL : 2);
  }
}
interface SkirmisherOrders {
  hostile: (a: number, b: number) => boolean;
  visible: (observer: Unit, target: Unit) => boolean;
  move: (state: GameState, unit: Unit, goal: Point, dt: number) => void;
  attack: (unit: Unit, target: Unit) => void;
}
interface Patrol extends DecisionClock { goal?: Point; retreatGoal?: Point; homeGoal?: Point; enemies: Unit[]; target?: Unit; nextPlanAt: number; index: number; retreatUntil: number }
const patrols = new WeakMap<Unit, Patrol>();
function clearJourney(unit: Unit): void { unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; }
function retreatGoal(state: GameState, unit: Unit, threats: readonly Unit[], home: Point): Point | undefined {
  const away = threats.reduce((sum, enemy) => { const d = Math.max(.25, distance(unit, enemy));
    return { x: sum.x + (unit.x - enemy.x) / d ** 2, y: sum.y + (unit.y - enemy.y) / d ** 2 }; }, { x: 0, y: 0 });
  const angle = Math.atan2(away.y, away.x), choices: { point: Point; score: number }[] = [];
  const current = Math.min(...threats.map(enemy => distance(unit, enemy)));
  for (let i = 0; i < 16; i++) {
    const a = angle + i * Math.PI / 8, point = { x: unit.x + Math.cos(a) * 2.5, y: unit.y + Math.sin(a) * 2.5 };
    if (!canMove(state, unit, point, unit.faction, undefined, true)) continue;
    const closest = Math.min(...threats.map(enemy => distance(point, enemy)));
    if (closest <= current + .1) continue;
    choices.push({ point, score: closest - Math.max(0, distance(point, home) - SKIRMISHER_PATROL_RADIUS) * 2 });
  }
  return choices.sort((a, b) => b.score - a.score)[0]?.point;
}
/** Patrol widely, throw at exposed enemies, and immediately break contact when
 * a hostile approaches. Retreat does not route the Leader or other soldiers. */
export function updateFortSkirmisher(state: GameState, unit: Unit, dt: number, orders: SkirmisherOrders): boolean {
  if (unit.kind !== 'skirmisher') return false;
  const fort = indexedBuilding(state, unit.fort);
  if (unit.hp <= 0 || !fort || fort.kind !== 'fort' || fort.hp <= 0) return true;
  const home = center(fort), data = fort.fort;
  let plan = patrols.get(unit);
  if (!plan) { plan = { nextPlanAt: 0, index: unit.id, retreatUntil: -1, enemies: [] }; patrols.set(unit, plan); }
  const think = !simulationReadsActive(state) || decisionDue(plan, state.time, unit.id);
  if (!buildingReady(fort) || data?.funded === false) {
    clearJourney(unit); unit.order = 'follow';
    if (distance(unit, home) <= 2) { unit.inside = true; unit.moving = false; }
    else {
      if (think) plan.homeGoal = constructionEdges(state, fort, true).sort((a, b) => distance(a, unit) - distance(b, unit))[0];
      if (plan.homeGoal) orders.move(state, unit, plan.homeGoal, dt);
    }
    return true;
  }
  if (unit.inside) {
    const exits = constructionEdges(state, fort, true), exit = exits[unit.id % Math.max(1, exits.length)];
    if (!exit) return true;
    unit.x = exit.x; unit.y = exit.y; unit.inside = false;
  }
  unit.moving = false;
  if (think) {
    plan.enemies = nearbyUnits(state, unit, 8).filter(enemy => enemy.hp > 0 && !enemy.inside
      && orders.hostile(unit.faction, enemy.faction) && orders.visible(unit, enemy))
      .sort((a, b) => distance(unit, a) - distance(unit, b) || a.id - b.id);
    if (plan.enemies.some(enemy => enemy.attack > 0 && distance(unit, enemy) <= SKIRMISHER_RETREAT_RADIUS)) plan.retreatUntil = state.time + 1;
    plan.target = plan.enemies.find(enemy => distance(enemy, home) <= SKIRMISHER_PATROL_RADIUS + 2);
    plan.retreatGoal = state.time < plan.retreatUntil ? retreatGoal(state, unit, plan.enemies.filter(enemy => enemy.attack > 0), home) : undefined;
  }
  const enemies = plan.enemies;
  if (state.time < plan.retreatUntil && enemies.length) {
    clearJourney(unit); plan.goal = undefined; unit.order = 'flee';
    if (plan.retreatGoal) orders.move(state, unit, plan.retreatGoal, dt);
    return true;
  }
  unit.order = 'wander';
  const cached = plan.target;
  const target = cached && cached.hp > 0 && !cached.inside && orders.hostile(unit.faction, cached.faction)
    && distance(cached, home) <= SKIRMISHER_PATROL_RADIUS + 2 ? cached : undefined;
  if (target) {
    unit.target = target.id;
    if (distance(unit, target) <= unitAttackRange(state.world, unit, target)) orders.attack(unit, target);
    else orders.move(state, unit, target, dt);
    return true;
  }
  unit.target = undefined;
  if (think && (!plan.goal || distance(unit, plan.goal) < .7 || state.time >= plan.nextPlanAt)) {
    plan.goal = undefined; clearJourney(unit);
    for (let i = 0; i < 12; i++) {
      const index = plan.index++, angle = index * 2.399963229728653, radius = 5 + index % 8;
      const point = { x: Math.floor(home.x + Math.cos(angle) * radius) + .5, y: Math.floor(home.y + Math.sin(angle) * radius) + .5 };
      if (canWalk(state, point.x, point.y, unit.faction, undefined, true) && hasStaticPath(state, unit, point, unit.faction)) { plan.goal = point; break; }
    }
    plan.nextPlanAt = state.time + 8;
  }
  if (plan.goal) orders.move(state, unit, plan.goal, dt);
  return true;
}
