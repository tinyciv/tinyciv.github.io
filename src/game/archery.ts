import { decisionDue, type DecisionClock } from './decision-schedule';
import { rustEngine } from './rust-engine';
import { isOffensiveMember } from './offensive-native';
import { UNIT_KIND_CODES, BUILDING_KIND_CODES } from './entity-store';
import { allocateRetinueFraction, nativeRetinueTargets, nativeRecruitRole, RETINUE_ROLES } from './retinue-native';
import { areSwordsmenUnlocked, areArchersUnlocked, areSpearmenUnlocked, arePikemenUnlocked, areMusketmenUnlocked, areHorsemenUnlocked, areHorseArchersUnlocked, areKnightsUnlocked, researchLevel } from './research';
import { buildingActivityAvailable, isCompositionBuilding } from './building-activity';
import { constructionEdges } from './builders';
import { canMove, canWalk, hasStaticPath } from './pathfinding';
import { nearbyUnits, unitOccupancy } from './spatial';
import { entityStore } from './entity-store';
import { structuresOf, STRUCTURE_READY } from './structure-index';
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
export type RetinueRole = 'warrior' | 'swordsman' | 'spearman' | 'pikeman' | 'musketman' | 'archer' | 'horseman' | 'horseArcher' | 'knight' | 'fieldCannon';
/** Pikemen keep the spearman's attack and reach with 50% more defense. */
export const PIKEMAN_DEFENSE_MULTIPLIER = 1.5;
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
const upkeepByKind = Object.fromEntries(Object.entries(UNIT_KIND_CODES).map(([kind, code]) => [kind, rustEngine.retinue_upkeep(code)]));
const timingByKind = Object.fromEntries(Object.entries(UNIT_KIND_CODES).map(([kind, code]) => [kind, {
  cooldown: rustEngine.retinue_attack_timing(code, 0), animation: rustEngine.retinue_attack_timing(code, 1),
}]));
const RANGER_UPKEEP = rustEngine.exploration_ranger(3, 1, 1);
const RANGER_FLEE_RADIUS = rustEngine.exploration_ranger(2, 1.8, 1);
export const retinueUpkeep = (unit: Pick<Unit, 'kind'> & { ranger?: boolean }): number => unit.ranger ? RANGER_UPKEEP : upkeepByKind[unit.kind];
export const unitAttackTiming = (unit: Pick<Unit, 'kind'>) => timingByKind[unit.kind];
export const mountedSpeedMultiplier = (kind: Unit['kind']): number => kind === 'knight' ? 1.45 : isMountedKind(kind) ? HORSEMAN_SPEED_MULTIPLIER : 1;
export const swordsmanFraction = (faction: Faction): number => areSwordsmenUnlocked(faction) ? Math.min(fractionOf(faction.swordsmanFraction), 1 - mountedFraction(faction)) : 0;
export const archerFraction = (faction: Faction): number => Math.min(fractionOf(faction.archerFraction), 1 - mountedFraction(faction) - swordsmanFraction(faction));
export const spearmanFraction = (faction: Faction): number => Math.min(fractionOf(faction.spearmanFraction), Math.max(0, 1 - mountedFraction(faction) - swordsmanFraction(faction) - archerFraction(faction)));
export const pikemanFraction = (faction: Faction): number => arePikemenUnlocked(faction)
  ? Math.min(fractionOf(faction.pikemanFraction), Math.max(0, 1 - mountedFraction(faction) - swordsmanFraction(faction) - archerFraction(faction) - spearmanFraction(faction))) : 0;
export const musketmanFraction = (faction: Faction): number => rustEngine.retinue_fraction(faction.musketmanFraction ?? 0,
  1 - mountedFraction(faction) - swordsmanFraction(faction) - archerFraction(faction) - spearmanFraction(faction) - pikemanFraction(faction), Number(areMusketmenUnlocked(faction)));
export const fieldCannonFraction = (faction: Faction): number => rustEngine.retinue_fraction(faction.fieldCannonFraction ?? 0,
  1 - mountedFraction(faction) - swordsmanFraction(faction) - archerFraction(faction) - spearmanFraction(faction) - pikemanFraction(faction) - musketmanFraction(faction), Number(researchLevel(faction, 'fieldCannon') > 0));
export const hasBarracks = (state: GameState, faction: number): boolean =>
  state.buildings.some(building => building.faction === faction && building.kind === 'barracks' && buildingReady(building));
export const canRecruitSpearmen = (state: GameState, faction: Faction): boolean =>
  areSpearmenUnlocked(faction) && factionHasDevelopedResource(state, faction.id, 'copper');
const members = (state: GameState, factionId: number): Unit[] => state.units.filter(unit => unit.faction === factionId
  && unit.hp > 0 && isRetinueMember(unit) && unit.marauderPack === undefined);
function roleUnlockMask(faction: Faction | undefined): number {
  const unlocked = [areKnightsUnlocked(faction), areHorseArchersUnlocked(faction), areHorsemenUnlocked(faction),
    areSwordsmenUnlocked(faction), areArchersUnlocked(faction), areSpearmenUnlocked(faction), arePikemenUnlocked(faction), areMusketmenUnlocked(faction), researchLevel(faction, 'fieldCannon') > 0, true];
  return unlocked.reduce((mask, allowed, index) => mask | Number(allowed) << index, 0);
}
function compositionTargets(state: GameState, faction: Faction | undefined, total: number): Record<RetinueRole, number> {
  return nativeRetinueTargets(state, faction, rustEngine.exploration_ordinary_slots(total, faction?.rangerCompanions ?? 0), roleUnlockMask(faction));
}
export function retinueComposition(state: GameState, factionId: number): { total: number; fieldCannons: number; currentFieldCannons: number; horseArchers: number; currentHorseArchers: number; knights: number; currentKnights: number; swordsmen: number; currentSwordsmen: number; archers: number; spearmen: number; pikemen: number; currentPikemen: number; musketmen: number; currentMusketmen: number; horsemen: number; warriors: number; currentHorsemen: number; currentArchers: number; currentSpearmen: number; training: number } {
  const faction = state.factions.find(faction => faction.id === factionId);
  const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === factionId && unit.hp > 0);
  const total = faction ? desiredRetinueSize(faction, leader) : 0;
  const wanted = compositionTargets(state, faction, total), soldiers = members(state, factionId).filter(unit => !unit.ranger);
  return { total, fieldCannons: wanted.fieldCannon, currentFieldCannons: soldiers.filter(unit => unit.kind === 'fieldCannon').length, horseArchers: wanted.horseArcher, knights: wanted.knight, currentHorseArchers: soldiers.filter(u => u.kind === 'horseArcher').length, currentKnights: soldiers.filter(u => u.kind === 'knight').length, swordsmen: wanted.swordsman, currentSwordsmen: soldiers.filter(unit => unit.kind === 'swordsman').length, archers: wanted.archer, spearmen: wanted.spearman, horsemen: wanted.horseman, warriors: wanted.warrior,
    currentHorsemen: soldiers.filter(unit => unit.kind === 'horseman').length,
    currentArchers: soldiers.filter(unit => unit.kind === 'archer').length,
    currentSpearmen: soldiers.filter(unit => unit.kind === 'spearman').length,
    musketmen: wanted.musketman, currentMusketmen: soldiers.filter(unit => unit.kind === 'musketman').length,
    pikemen: wanted.pikeman, currentPikemen: soldiers.filter(unit => unit.kind === 'pikeman').length,
    training: soldiers.filter(unit => unit.training).length };
}
/** All composition buildings edit the same faction-wide quotas. Training still
 * takes place at each role's own school, using the normal recruitment rules. */
export function setRetinueFraction(state: GameState, building: Building, role: RetinueRole, fraction: number): boolean {
  const faction = state.factions.find(faction => faction.id === building.faction);
  if (!buildingActivityAvailable(state, building) || !isCompositionBuilding(building) || !faction
    || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return false;
  if (fraction > 0 && (role === 'archer' && !areArchersUnlocked(faction)
    || role === 'swordsman' && !areSwordsmenUnlocked(faction)
    || role === 'spearman' && !canRecruitSpearmen(state, faction)
    || role === 'pikeman' && !arePikemenUnlocked(faction)
    || role === 'musketman' && !areMusketmenUnlocked(faction)
    || role === 'fieldCannon' && !researchLevel(faction, 'fieldCannon')
    || !mountedRoleUnlocked(faction, role))) return false;
  if (!allocateRetinueFraction(state, faction, role, fraction, [knightFraction(faction), horseArcherFraction(faction),
    horsemanFraction(faction), swordsmanFraction(faction), archerFraction(faction), spearmanFraction(faction), pikemanFraction(faction), musketmanFraction(faction), fieldCannonFraction(faction)],
    structuresOf(state, faction.id, STRUCTURE_READY, 'archeryRange', 'blacksmith', 'stable', 'barracks', 'foundry'),
    roleUnlockMask(faction) & (canRecruitSpearmen(state, faction) ? -1 : ~(1 << RETINUE_ROLES.indexOf('spearman'))))) return false;
  scheduleArcheryTraining(state, true);
  return true;
}

export const setWarriorFraction = (state: GameState, building: Building, fraction: number): boolean => setRetinueFraction(state, building, 'warrior', fraction);
export const setArcherFraction = (state: GameState, building: Building, fraction: number): boolean => setRetinueFraction(state, building, 'archer', fraction);
export const setSwordsmanFraction = (state: GameState, building: Building, fraction: number): boolean => setRetinueFraction(state, building, 'swordsman', fraction);
export const setSpearmanFraction = (state: GameState, building: Building, fraction: number): boolean => setRetinueFraction(state, building, 'spearman', fraction);
export const setPikemanFraction = (state: GameState, building: Building, fraction: number): boolean => setRetinueFraction(state, building, 'pikeman', fraction);
export const setMountedFraction = (state: GameState, building: Building, role: 'horseman' | 'horseArcher' | 'knight', fraction: number): boolean => setRetinueFraction(state, building, role, fraction);
export const setHorsemanFraction = (state: GameState, building: Building, fraction: number): boolean => setMountedFraction(state, building, 'horseman', fraction);
export const setHorseArcherFraction = (state: GameState, building: Building, fraction: number): boolean => setMountedFraction(state, building, 'horseArcher', fraction);
export const setKnightFraction = (state: GameState, building: Building, fraction: number): boolean => setMountedFraction(state, building, 'knight', fraction);

const ROLE_STATS = Object.fromEntries([...RETINUE_ROLES, 'scout'].map((role, index) => [role, {
  hp: rustEngine.retinue_stat(index, 0), attack: rustEngine.retinue_stat(index, 1), defense: rustEngine.retinue_stat(index, 2),
  speed: rustEngine.retinue_stat(index, 3), range: rustEngine.retinue_stat(index, 4),
}])) as Record<RetinueRole | 'scout', { hp: number; attack: number; defense: number; speed: number; range: number }>;
const roleSchool = (role: RetinueRole, school: Building): boolean =>
  !!rustEngine.retinue_training_school(RETINUE_ROLES.indexOf(role), BUILDING_KIND_CODES[school.kind]);
/** Preserve wounds, equipment, squad identity and veterancy across role changes.
 * Scout attack is zero even before the simulation's noncombat dispatch guard. */
export function setSoldierRole(unit: Unit, role: RetinueRole | 'scout'): void {
  if (unit.ranger) return;
  const wasScout = unit.kind === 'scout';
  const previous = ROLE_STATS[unit.kind as RetinueRole | 'scout'] ?? ROLE_STATS.warrior;
  const base = unit.warriorStats ??= { hp: (unit.maxHp ?? 100) / previous.hp, attack: unit.attack / (previous.attack || 1), defense: unit.defense / previous.defense, speed: unit.speed / previous.speed };
  base.speed ??= unit.speed / previous.speed;
  const health = Math.max(0, Math.min(1, unit.hp / (unit.maxHp ?? base.hp))), stats = ROLE_STATS[role];
  unit.kind = role;
  unit.maxHp = base.hp * stats.hp; unit.hp = unit.maxHp * health;
  unit.attack = base.attack * stats.attack; unit.defense = base.defense * stats.defense;
  unit.speed = base.speed * stats.speed; unit.range = stats.range;
  if (role !== 'fieldCannon') delete unit.fieldCannon;
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
  const soldiers = members(state, faction.id).filter(unit => !unit.ranger);
  compositionTargets(state, faction, desiredRetinueSize(faction, leader));
  return nativeRecruitRole(state, soldiers, structuresOf(state, faction.id, STRUCTURE_READY, 'archeryRange', 'blacksmith', 'stable', 'barracks', 'foundry'), spearsAvailable);
}
const clearTrainingPath = (unit: Unit): void => {
  unit.path = undefined; unit.pathGoal = undefined; unit.destination = undefined; unit.target = undefined; unit.repathAt = 0;
};
const nextPlans = new WeakMap<GameState, number>();
const trainingDeferrals = new WeakMap<Unit, {state: GameState; until: number}>();
/** Explicit field orders and an unreachable school take priority over retraining. */
export function interruptOutboundTraining(state: GameState, unit: Unit): void {
  if (unit.training?.enteredAt !== undefined) return;
  if (unit.training) { delete unit.training; clearTrainingPath(unit); }
  trainingDeferrals.set(unit, {state, until: state.time + 30});
}
/** One allocator owns combat roles, so the building sliders cannot send
 * the same soldier back and forth to meet conflicting independent quotas. */
export function scheduleArcheryTraining(state: GameState, immediate = false): void {
  if (!immediate && state.time < (nextPlans.get(state) ?? 0)) return;
  nextPlans.set(state, state.time + 1);
  for (const faction of state.factions) {
    const schools = structuresOf(state, faction.id, STRUCTURE_READY, 'archeryRange', 'blacksmith', 'stable', 'barracks', 'foundry');
    const soldiers = members(state, faction.id).filter(unit => !unit.ranger);
    // Entered trainees finish safely; only outbound trips can be cancelled.
    for (const unit of soldiers) if (immediate && unit.training && unit.training.enteredAt === undefined) {
      delete unit.training; clearTrainingPath(unit);
    }
    const wanted = compositionTargets(state, faction, soldiers.length + (faction.rangerCompanions ?? 0)), projected: Record<RetinueRole, number> = { fieldCannon: 0, warrior: 0, swordsman: 0, spearman: 0, pikeman: 0, musketman: 0, archer: 0, horseman: 0, horseArcher: 0, knight: 0 };
    for (const unit of soldiers) projected[(unit.training?.role ?? unit.kind) as RetinueRole]++;
    for (const role of ['fieldCannon', 'knight', 'horseArcher', 'horseman', 'archer', 'spearman', 'pikeman', 'musketman', 'swordsman', 'warrior'] as const) {
      if (role === 'swordsman' && !areSwordsmenUnlocked(faction) || role === 'archer' && !areArchersUnlocked(faction) || role === 'spearman' && !canRecruitSpearmen(state, faction) || role === 'pikeman' && !arePikemenUnlocked(faction) || role === 'musketman' && !areMusketmenUnlocked(faction)
    || role === 'fieldCannon' && !researchLevel(faction, 'fieldCannon') || !mountedRoleUnlocked(faction, role)) continue;
      const classrooms = schools.filter(school => roleSchool(role, school));
      let needed = wanted[role] - projected[role];
      if (needed <= 0 || !classrooms.length) continue;
      const candidates = soldiers.filter(unit => unit.kind !== role && !unit.training && !unit.garrison && !unit.inside && !unit.routed && unit.order !== 'flee' && !isOffensiveMember(state, unit)
        && unit.recallIssuedAt === undefined && !unit.forcedAttack
        && !(trainingDeferrals.get(unit)?.state === state && trainingDeferrals.get(unit)!.until > state.time))
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
  const validSchool = range && roleSchool(training.role, range);
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
    if (training.role === 'fieldCannon') unit.fieldCannon = { nextUpkeepAt: state.time + rustEngine.field_cannon_constant(3), funded: true };
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
    else if (plan.sampledAt !== undefined) { interruptOutboundTraining(state, unit); return false; }
  }
  return true;
}

/** Back away from nearby melee attackers without teleporting through traffic,
 * terrain or walls. A fully blocked archer may defend from its current cell. */
export function evadeMelee(state: GameState, unit: Unit, dt: number, move: Move,
  hostile: (a: number, b: number) => boolean, visible: (target: Unit) => boolean): boolean {
  if ((unit.kind !== 'musketman' && unit.kind !== 'archer' && unit.kind !== 'horseArcher' && unit.kind !== 'slinger') || unit.inside) return false;
  let plan = evasions.get(unit);
  if (!plan) { plan = {}; evasions.set(unit, plan); }
  if (!decisionDue(plan, state.time, unit.id)) {
    if (!plan.goal || distance(unit, plan.goal) < .1 || !canWalk(state, plan.goal.x, plan.goal.y, unit.faction)
      || !canMove(state, unit, plan.goal, unit.faction)) return false;
    move(state, unit, plan.goal, dt); return true;
  }
  plan.goal = undefined;
  const fleeRadius = unit.ranger ? RANGER_FLEE_RADIUS : 1.8;
  const threats = nearbyUnits(state, unit, fleeRadius).filter(other => other.hp > 0 && !other.inside && other.range <= 1.5
    && hostile(unit.faction, other.faction) && distance(unit, other) < fleeRadius && visible(other));
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
