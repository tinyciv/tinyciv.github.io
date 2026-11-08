import { decisionDue, type DecisionClock } from './decision-schedule';
import { areSwordsmenUnlocked, areArchersUnlocked, areSpearmenUnlocked, areHorsemenUnlocked, areHorseArchersUnlocked, areKnightsUnlocked } from './research';
import { buildingActivityAvailable } from './building-activity';
import { constructionEdges } from './builders';
import { canMove, canWalk, hasStaticPath } from './pathfinding';
import { nearbyUnits, unitOccupancy } from './spatial';
import { entityStore } from './entity-store';
import { SPEARMAN_DEFENSE_MULTIPLIER, SPEARMAN_RANGE } from './spearmen';
import { purchasedRetinueSlots } from './retinue-purchases';
import { leaderRetinueBonus } from './leader-progression';
import { factionHasDevelopedResource } from './resource-development';
import { isMountedKind, buildingHeight, buildingReady, buildingWidth, distance, isRetinueMember, type Building, type Faction, type GameState, type Point, type Unit } from './types';

export const ARCHER_RANGE = 4;
export const ARCHER_EXTRA_UPKEEP = .5;
export const ARCHERY_TRAINING_SECONDS = 2;
export function desiredRetinueSize(faction: Faction, leader?: Unit): number {
  const population = Math.max(0, faction.population);
  return 4 + Math.floor(Math.min(population, 100) / 20)
    + Math.floor(Math.max(0, Math.min(population - 100, 400)) / 50)
    + Math.floor(Math.max(0, population - 500) / 75)
    + (Number.isFinite(faction.bonusRetinueSlots) ? Math.max(0, Math.floor(faction.bonusRetinueSlots!)) : 0)
    + purchasedRetinueSlots(faction) + leaderRetinueBonus(leader);
}
export type RetinueRole = 'warrior' | 'swordsman' | 'spearman' | 'archer' | 'horseman' | 'horseArcher' | 'knight';
export const SWORDSMAN_ATTACK_MULTIPLIER = 2;
export const HORSEMAN_SPEED_MULTIPLIER = 1.65;
export const HORSEMAN_ATTACK_MULTIPLIER = 1.5;
export const SCOUT_SPEED_MULTIPLIER = 1.2;
const fractionOf = (value: number | undefined): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 0;
export const knightFraction = (faction: Faction): number => areKnightsUnlocked(faction) ? fractionOf(faction.knightFraction) : 0;
export const horseArcherFraction = (faction: Faction): number => areHorseArchersUnlocked(faction) ? Math.min(fractionOf(faction.horseArcherFraction), 1 - knightFraction(faction)) : 0;
export const horsemanFraction = (faction: Faction): number => areHorsemenUnlocked(faction) ? Math.min(fractionOf(faction.horsemanFraction), 1 - knightFraction(faction) - horseArcherFraction(faction)) : 0;
export const mountedFraction = (faction: Faction): number => horsemanFraction(faction) + horseArcherFraction(faction) + knightFraction(faction);
export const mountedRoleUnlocked = (faction: Pick<Faction, 'research'> | undefined, role: RetinueRole): boolean =>
  role === 'knight' ? areKnightsUnlocked(faction) : role === 'horseArcher' ? areHorseArchersUnlocked(faction) : role === 'horseman' ? areHorsemenUnlocked(faction) : true;
export const retinueUpkeep = (unit: Pick<Unit, 'kind'>): number => unit.kind === 'knight' ? 2 : unit.kind === 'horseArcher' ? 1.5 : unit.kind === 'horseman' || unit.kind === 'archer' ? 1 : .5;
export const mountedSpeedMultiplier = (kind: Unit['kind']): number => kind === 'knight' ? 1.45 : isMountedKind(kind) ? HORSEMAN_SPEED_MULTIPLIER : 1;
export const swordsmanFraction = (faction: Faction): number => areSwordsmenUnlocked(faction) ? Math.min(fractionOf(faction.swordsmanFraction), 1 - mountedFraction(faction)) : 0;
export const archerFraction = (faction: Faction): number => Math.min(fractionOf(faction.archerFraction), 1 - mountedFraction(faction) - swordsmanFraction(faction));
export const spearmanFraction = (faction: Faction): number => Math.min(fractionOf(faction.spearmanFraction), Math.max(0, 1 - mountedFraction(faction) - swordsmanFraction(faction) - archerFraction(faction)));
export const canRecruitSpearmen = (state: GameState, faction: Faction): boolean =>
  areSpearmenUnlocked(faction) && factionHasDevelopedResource(state, faction.id, 'copper');
const members = (state: GameState, factionId: number): Unit[] => state.units.filter(unit => unit.faction === factionId
  && unit.hp > 0 && isRetinueMember(unit) && unit.marauderPack === undefined);
function compositionTargets(faction: Faction | undefined, total: number): Record<RetinueRole, number> {
  const knight = Math.min(total, Math.round(total * (faction ? knightFraction(faction) : 0)));
  const horseArcher = Math.min(total - knight, Math.round(total * (faction ? horseArcherFraction(faction) : 0)));
  const horseman = Math.min(total - knight - horseArcher, Math.round(total * (faction ? horsemanFraction(faction) : 0)));
  const mounted = knight + horseArcher + horseman;
  const swordsman = Math.min(total - mounted, Math.round(total * (faction ? swordsmanFraction(faction) : 0)));
  const archer = Math.min(total - mounted - swordsman, Math.round(total * (faction ? archerFraction(faction) : 0)));
  const spearman = Math.min(total - mounted - swordsman - archer, Math.round(total * (faction ? spearmanFraction(faction) : 0)));
  return { archer, spearman, horseman, horseArcher, knight, swordsman, warrior: total - mounted - swordsman - archer - spearman };
}
export function retinueComposition(state: GameState, factionId: number): { total: number; horseArchers: number; currentHorseArchers: number; knights: number; currentKnights: number; swordsmen: number; currentSwordsmen: number; archers: number; spearmen: number; horsemen: number; warriors: number; currentHorsemen: number; currentArchers: number; currentSpearmen: number; training: number } {
  const faction = state.factions.find(faction => faction.id === factionId);
  const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === factionId && unit.hp > 0);
  const total = faction ? desiredRetinueSize(faction, leader) : 0;
  const wanted = compositionTargets(faction, total), soldiers = members(state, factionId);
  return { total, horseArchers: wanted.horseArcher, knights: wanted.knight, currentHorseArchers: soldiers.filter(u => u.kind === 'horseArcher').length, currentKnights: soldiers.filter(u => u.kind === 'knight').length, swordsmen: wanted.swordsman, currentSwordsmen: soldiers.filter(unit => unit.kind === 'swordsman').length, archers: wanted.archer, spearmen: wanted.spearman, horsemen: wanted.horseman, warriors: wanted.warrior,
    currentHorsemen: soldiers.filter(unit => unit.kind === 'horseman').length,
    currentArchers: soldiers.filter(unit => unit.kind === 'archer').length,
    currentSpearmen: soldiers.filter(unit => unit.kind === 'spearman').length,
    training: soldiers.filter(unit => unit.training).length };
}
export function setArcherFraction(state: GameState, range: Building, fraction: number): boolean {
  const faction = state.factions.find(faction => faction.id === range.faction);
  if (!buildingActivityAvailable(state, range) || !faction || range.kind !== 'archeryRange' || !buildingReady(range) || !Number.isFinite(fraction)) return false;
  if (fraction > 0 && !areArchersUnlocked(faction)) return false;
  faction.archerFraction = Math.round(Math.max(0, Math.min(1 - mountedFraction(faction) - swordsmanFraction(faction), fraction)) * 100) / 100;
  faction.spearmanFraction = Math.min(fractionOf(faction.spearmanFraction), Math.max(0, 1 - mountedFraction(faction) - swordsmanFraction(faction) - faction.archerFraction));
  scheduleArcheryTraining(state, true);
  return true;
}
export function setSwordsmanFraction(state: GameState, blacksmith: Building, fraction: number): boolean {
  const faction = state.factions.find(f => f.id === blacksmith.faction);
  if (!buildingActivityAvailable(state, blacksmith) || !faction || blacksmith.kind !== 'blacksmith' || !buildingReady(blacksmith) || !Number.isFinite(fraction)) return false;
  if (fraction > 0 && !areSwordsmenUnlocked(faction)) return false;
  faction.swordsmanFraction = Math.round(Math.max(0, Math.min(1 - mountedFraction(faction), fraction)) * 100) / 100;
  faction.archerFraction = Math.min(fractionOf(faction.archerFraction), Math.max(0, 1 - mountedFraction(faction) - swordsmanFraction(faction)));
  faction.spearmanFraction = Math.min(fractionOf(faction.spearmanFraction), Math.max(0, 1 - mountedFraction(faction) - swordsmanFraction(faction) - archerFraction(faction)));
  scheduleArcheryTraining(state, true);
  return true;
}

export function setSpearmanFraction(state: GameState, blacksmith: Building, fraction: number): boolean {
  const faction = state.factions.find(faction => faction.id === blacksmith.faction);
  if (!buildingActivityAvailable(state, blacksmith) || !faction || blacksmith.kind !== 'blacksmith' || !buildingReady(blacksmith) || !Number.isFinite(fraction)) return false;
  if (fraction > 0 && !canRecruitSpearmen(state, faction)) return false;
  const archers = archerFraction(faction);
  faction.spearmanFraction = Math.round(Math.max(0, Math.min(1 - mountedFraction(faction) - swordsmanFraction(faction), fraction)) * 100) / 100;
  faction.archerFraction = Math.min(archers, Math.max(0, 1 - mountedFraction(faction) - swordsmanFraction(faction) - faction.spearmanFraction));
  scheduleArcheryTraining(state, true);
  return true;
}

/** A stable mounts the selected share without creating extra retinue slots. */
export function setMountedFraction(state: GameState, stable: Building, role: 'horseman' | 'horseArcher' | 'knight', fraction: number): boolean {
  const faction = state.factions.find(f => f.id === stable.faction);
  if (!buildingActivityAvailable(state, stable) || !faction || stable.kind !== 'stable' || !buildingReady(stable)
    || !Number.isFinite(fraction) || fraction < 0 || fraction > 1 || fraction > 0 && !mountedRoleUnlocked(faction, role)) return false;
  const current = role === 'knight' ? knightFraction(faction) : role === 'horseArcher' ? horseArcherFraction(faction) : horsemanFraction(faction);
  faction[role === 'knight' ? 'knightFraction' : role === 'horseArcher' ? 'horseArcherFraction' : 'horsemanFraction'] = Math.round(Math.min(1 - mountedFraction(faction) + current, fraction) * 100) / 100;
  faction.swordsmanFraction = Math.min(fractionOf(faction.swordsmanFraction), 1 - mountedFraction(faction));
  faction.archerFraction = Math.min(fractionOf(faction.archerFraction), 1 - mountedFraction(faction) - swordsmanFraction(faction));
  faction.spearmanFraction = Math.min(fractionOf(faction.spearmanFraction), Math.max(0, 1 - mountedFraction(faction) - swordsmanFraction(faction) - archerFraction(faction)));
  scheduleArcheryTraining(state, true);
  return true;
}
export const setHorsemanFraction = (state: GameState, stable: Building, fraction: number): boolean => setMountedFraction(state, stable, 'horseman', fraction);
export const setHorseArcherFraction = (state: GameState, stable: Building, fraction: number): boolean => setMountedFraction(state, stable, 'horseArcher', fraction);
export const setKnightFraction = (state: GameState, stable: Building, fraction: number): boolean => setMountedFraction(state, stable, 'knight', fraction);

const ROLE_STATS: Record<RetinueRole | 'scout', { hp: number; attack: number; defense: number; speed: number; range: number }> = {
  warrior: { hp: 1, attack: 1, defense: 1, speed: 1, range: 1.1 },
  swordsman: { hp: 1, attack: SWORDSMAN_ATTACK_MULTIPLIER, defense: 1, speed: 1, range: 1.1 },
  spearman: { hp: 1, attack: 1, defense: SPEARMAN_DEFENSE_MULTIPLIER, speed: 1, range: SPEARMAN_RANGE },
  archer: { hp: 2 / 3, attack: .8, defense: .5, speed: 1, range: ARCHER_RANGE },
  horseman: { hp: 1, attack: HORSEMAN_ATTACK_MULTIPLIER, defense: .75, speed: HORSEMAN_SPEED_MULTIPLIER, range: 1.4 },
  horseArcher: { hp: .8, attack: .8, defense: .5, speed: HORSEMAN_SPEED_MULTIPLIER, range: 4.5 },
  knight: { hp: 1.8, attack: 2.5, defense: 2.5, speed: 1.45, range: 1.3 },
  scout: { hp: 1, attack: 0, defense: 1, speed: SCOUT_SPEED_MULTIPLIER, range: 0 },
};
/** Preserve wounds, equipment, squad identity and veterancy across role changes.
 * Scout attack is zero even before the simulation's noncombat dispatch guard. */
export function setSoldierRole(unit: Unit, role: RetinueRole | 'scout'): void {
  const wasScout = unit.kind === 'scout';
  const previous = ROLE_STATS[unit.kind as RetinueRole | 'scout'] ?? ROLE_STATS.warrior;
  const base = unit.warriorStats ??= { hp: (unit.maxHp ?? 100) / previous.hp, attack: unit.attack / (previous.attack || 1), defense: unit.defense / previous.defense, speed: unit.speed / previous.speed };
  base.speed ??= unit.speed / previous.speed;
  const health = Math.max(0, Math.min(1, unit.hp / (unit.maxHp ?? base.hp))), stats = ROLE_STATS[role];
  unit.kind = role;
  unit.maxHp = base.hp * stats.hp; unit.hp = unit.maxHp * health;
  unit.attack = base.attack * stats.attack; unit.defense = base.defense * stats.defense;
  unit.speed = base.speed * stats.speed; unit.range = stats.range;
  if (role === 'scout' || wasScout) {
    delete unit.forcedAttack; delete unit.attackReturn; delete unit.target;
    unit.attackTime = 0;
  }
}
export function nextRecruitRole(state: GameState, faction: Faction): RetinueRole {
  return recruitRole(state, faction, canRecruitSpearmen(state, faction));
}
/** The advanced scenario grants an already equipped escort once at creation. */
export function advancedStartingEscortRole(state: GameState, faction: Faction): RetinueRole {
  return recruitRole(state, faction, areSpearmenUnlocked(faction));
}
function recruitRole(state: GameState, faction: Faction, spearsAvailable: boolean): RetinueRole {
  const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === faction.id && unit.hp > 0);
  const soldiers = members(state, faction.id), wanted = compositionTargets(faction, desiredRetinueSize(faction, leader));
  const projected = (role: RetinueRole) => soldiers.filter(unit => (unit.training?.role ?? unit.kind) === role).length;
  for (const role of ['knight', 'horseArcher', 'horseman'] as const) if (mountedRoleUnlocked(faction, role) && projected(role) < wanted[role]
    && state.buildings.some(building => building.faction === faction.id && building.kind === 'stable' && buildingReady(building))) return role;
  if (areArchersUnlocked(faction) && projected('archer') < wanted.archer) return 'archer';
  if (spearsAvailable && state.buildings.some(building => building.faction === faction.id
    && building.kind === 'blacksmith' && buildingReady(building)) && projected('spearman') < wanted.spearman) return 'spearman';
  if (areSwordsmenUnlocked(faction) && projected('swordsman') < wanted.swordsman && state.buildings.some(b => b.faction === faction.id && b.kind === 'blacksmith' && buildingReady(b))) return 'swordsman';
  return 'warrior';
}
const clearTrainingPath = (unit: Unit): void => {
  unit.path = undefined; unit.pathGoal = undefined; unit.destination = undefined; unit.target = undefined; unit.repathAt = 0;
};
const nextPlans = new WeakMap<GameState, number>();
/** One allocator owns all five combat roles, so the building sliders cannot send
 * the same soldier back and forth to meet conflicting independent quotas. */
export function scheduleArcheryTraining(state: GameState, immediate = false): void {
  if (!immediate && state.time < (nextPlans.get(state) ?? 0)) return;
  nextPlans.set(state, state.time + 1);
  for (const faction of state.factions) {
    const schools = state.buildings.filter(building => building.faction === faction.id
      && (building.kind === 'archeryRange' || building.kind === 'blacksmith' || building.kind === 'stable') && buildingReady(building));
    const soldiers = members(state, faction.id);
    // Entered trainees finish safely; only outbound trips can be cancelled.
    for (const unit of soldiers) if (immediate && unit.training && unit.training.enteredAt === undefined) {
      delete unit.training; clearTrainingPath(unit);
    }
    const wanted = compositionTargets(faction, soldiers.length), projected: Record<RetinueRole, number> = { warrior: 0, swordsman: 0, spearman: 0, archer: 0, horseman: 0, horseArcher: 0, knight: 0 };
    for (const unit of soldiers) projected[(unit.training?.role ?? unit.kind) as RetinueRole]++;
    for (const role of ['knight', 'horseArcher', 'horseman', 'archer', 'spearman', 'swordsman', 'warrior'] as const) {
      if (role === 'swordsman' && !areSwordsmenUnlocked(faction) || role === 'archer' && !areArchersUnlocked(faction) || role === 'spearman' && !canRecruitSpearmen(state, faction) || !mountedRoleUnlocked(faction, role)) continue;
      const classrooms = schools.filter(school => isMountedKind(role) ? school.kind === 'stable' : role === 'spearman' || role === 'swordsman' ? school.kind === 'blacksmith' : role === 'warrior' || school.kind === 'archeryRange');
      let needed = wanted[role] - projected[role];
      if (needed <= 0 || !classrooms.length) continue;
      const candidates = soldiers.filter(unit => unit.kind !== role && !unit.training && !unit.garrison && !unit.inside && !unit.routed && unit.order !== 'flee')
        .sort((a, b) => Math.min(...classrooms.map(school => distance(a, school))) - Math.min(...classrooms.map(school => distance(b, school))) || a.id - b.id);
      for (const unit of candidates) {
        const from = unit.kind as RetinueRole;
        if (projected[from] <= wanted[from]) continue;
        const school = classrooms.slice().sort((a, b) => distance(unit, a) - distance(unit, b)).find(school =>
          constructionEdges(state, school).some(edge => hasStaticPath(state, unit, edge, unit.faction)));
        if (!school) continue;
        unit.training = { range: school.id, role };
        clearTrainingPath(unit);
        projected[from]--; projected[role]++;
        if (!--needed) break;
      }
    }
  }
}
interface TrainingPlan extends DecisionClock { training: NonNullable<Unit['training']>; goal?: Point }
const trainingPlans = new WeakMap<Unit, TrainingPlan>();
interface EvasionPlan extends DecisionClock { goal?: Point }
const evasions = new WeakMap<Unit, EvasionPlan>();

type Move = (state: GameState, unit: Unit, goal: Point, dt: number) => void;
export function updateArcheryTraining(state: GameState, unit: Unit, dt: number, move: Move): boolean {
  const training = unit.training;
  if (!training) return false;
  let plan = trainingPlans.get(unit);
  if (!plan) { plan = { training }; trainingPlans.set(unit, plan); }
  if (plan.training !== training) { plan.training = training; plan.goal = undefined; }
  const school = entityStore(state).buildings.get(training.range);
  const range = school && school.faction === unit.faction && buildingReady(school) ? school : undefined;
  const validSchool = range && (isMountedKind(training.role) ? range.kind === 'stable'
    : training.role === 'spearman' || training.role === 'swordsman' ? range.kind === 'blacksmith'
    : training.role === 'warrior' ? range.kind === 'stable' || range.kind === 'archeryRange' || range.kind === 'blacksmith' : range.kind === 'archeryRange');
  if (!range || !validSchool || !mountedRoleUnlocked(state.factions.find(f => f.id === unit.faction), training.role) || unit.order === 'flee' || training.role === 'swordsman' && !areSwordsmenUnlocked(state.factions.find(f => f.id === unit.faction))) {
    // Hidden trainees share the classroom position. Evacuate them onto distinct
    // clear cells after collapse, waiting safely if a crowd occupies every exit.
    if (training.enteredAt !== undefined) {
      if (!decisionDue(plan, state.time, unit.id)) return true;
      const occupied = unitOccupancy(state, unit), options: Point[] = school ? constructionEdges(state, school) : [];
      if (!school) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++)
        options.push({ x: Math.floor(unit.x) + dx + .5, y: Math.floor(unit.y) + dy + .5 });
      const exit = options.sort((a, b) => distance(unit, a) - distance(unit, b)).find(point =>
        canWalk(state, point.x, point.y, unit.faction) && !occupied.has(Math.floor(point.y) * state.world.width + Math.floor(point.x))
        // An entered trainee is inside the building, not a navigation cell.
        // On capture it leaves through a clear perimeter exit; asking the
        // pathfinder to cross the still-solid classroom would trap it forever.
        && (!!school || canMove(state, unit, point, unit.faction)));
      if (!exit) return true;
      unit.x = exit.x; unit.y = exit.y; unit.joiningRetinue = true;
    }
    unit.inside = false; delete unit.training; unit.path = undefined; unit.pathGoal = undefined; unit.destination = undefined; unit.repathAt = 0;
    return false;
  }
  if (training.enteredAt !== undefined) {
    // A lost mine pauses unissued spears; existing soldiers retain their arms.
    if (training.role === 'spearman' && !factionHasDevelopedResource(state, unit.faction, 'copper')) return true;
    if (state.time - training.enteredAt < ARCHERY_TRAINING_SECONDS || !decisionDue(plan, state.time, unit.id)) return true;
    const edges = constructionEdges(state, range), occupied = unitOccupancy(state, unit);
    const exit = edges.find(edge => !occupied.has(Math.floor(edge.y) * state.world.width + Math.floor(edge.x)));
    if (!exit) return true;
    setSoldierRole(unit, training.role);
    entityStore(state).units.updateRoles(unit);
    unit.inside = false; unit.x = exit.x; unit.y = exit.y;
    delete unit.training; unit.joiningRetinue = true;
    unit.path = undefined; unit.pathGoal = undefined; unit.destination = undefined; unit.target = undefined; unit.repathAt = 0;
    return true;
  }
  if (training.role === 'spearman' && !factionHasDevelopedResource(state, unit.faction, 'copper')) {
    delete unit.training; clearTrainingPath(unit); return false;
  }
  if (unit.routed || (unit.lastDamagedAt ?? -100) > state.time - 3) return false;
  const gap = Math.hypot(Math.max(range.x - unit.x, 0, unit.x - range.x - buildingWidth(range)),
    Math.max(range.y - unit.y, 0, unit.y - range.y - buildingHeight(range)));
  if (gap <= .65) {
    training.enteredAt = state.time; unit.inside = true; unit.moving = false;
    unit.x = range.x + buildingWidth(range) / 2; unit.y = range.y + buildingHeight(range) / 2;
    unit.path = undefined; unit.destination = undefined; unit.target = undefined;
  } else {
    if (decisionDue(plan, state.time, unit.id)) {
      plan.goal = constructionEdges(state, range).sort((a, b) => distance(unit, a) - distance(unit, b))
        .find(edge => hasStaticPath(state, unit, edge, unit.faction));
    }
    if (plan.goal) move(state, unit, plan.goal, dt);
  }
  return true;
}

/** Back away from nearby melee attackers without teleporting through traffic,
 * terrain or walls. A fully blocked archer may defend from its current cell. */
export function evadeMelee(state: GameState, unit: Unit, dt: number, move: Move,
  hostile: (a: number, b: number) => boolean, visible: (target: Unit) => boolean): boolean {
  if ((unit.kind !== 'archer' && unit.kind !== 'horseArcher' && unit.kind !== 'slinger') || unit.inside) return false;
  let plan = evasions.get(unit);
  if (!plan) { plan = {}; evasions.set(unit, plan); }
  if (!decisionDue(plan, state.time, unit.id)) {
    if (!plan.goal || distance(unit, plan.goal) < .1 || !canWalk(state, plan.goal.x, plan.goal.y, unit.faction)
      || !canMove(state, unit, plan.goal, unit.faction)) return false;
    move(state, unit, plan.goal, dt); return true;
  }
  plan.goal = undefined;
  const threats = nearbyUnits(state, unit, 1.8).filter(other => other.hp > 0 && !other.inside && other.range <= 1.5
    && hostile(unit.faction, other.faction) && distance(unit, other) < 1.8 && visible(other));
  if (!threats.length) return false;
  const occupied = unitOccupancy(state, unit), away = threats.reduce((p, enemy) => ({ x: p.x + unit.x - enemy.x, y: p.y + unit.y - enemy.y }), { x: 0, y: 0 });
  const angle = Math.atan2(away.y, away.x), nearest = Math.min(...threats.map(enemy => distance(unit, enemy)));
  for (const turn of [0, .5, -.5, 1, -1, 1.5, -1.5]) {
    const point = { x: unit.x + Math.cos(angle + turn) * 1.1, y: unit.y + Math.sin(angle + turn) * 1.1 };
    if (!canWalk(state, point.x, point.y, unit.faction) || !canMove(state, unit, point, unit.faction)
      || occupied.has(Math.floor(point.y) * state.world.width + Math.floor(point.x))
      || Math.min(...threats.map(enemy => distance(point, enemy))) <= nearest + .2) continue;
    unit.path = undefined; unit.destination = undefined; unit.repathAt = 0;
    plan.goal = point; move(state, unit, point, dt); return true;
  }
  return false;
}
