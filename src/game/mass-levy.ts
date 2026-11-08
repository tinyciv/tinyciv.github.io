import { buildingActivityAvailable } from './building-activity';
import { isKeep } from './settlement-upgrades';
import { buildingReady, type Building } from './types';
import { equipUnitFromFaction } from './blacksmith';
import { constructionEdges } from './builders';
import { panicCivilian } from './civilian-panic';
import { recordCivilianCasualty, workerHomeCity } from './civilian-population';
import { entityStore } from './entity-store';
import { releaseAttackSpot } from './engagement';
import { releaseCollectorWork } from './farms';
import { forbiddenRevision } from './forbidden-zones';
import { spendGold } from './gold-ledger';
import { announceArmyMobilization } from './army-warnings';
import { canWalk, invalidateNavigation, withNavigationFrame } from './pathfinding';
import { playerFaction } from './player-context';
import { researchLevel } from './research';
import { invalidateSettlementDecisions } from './settlement-decisions';
import { distance, type GameState, type Point, type Unit } from './types';

export const SLINGER_ATTACK = 17 * .8 * .75;
export const SLINGER_HEALTH = 40;
export const SLINGER_DEFENSE = 1;
export const SLINGER_RANGE = 4;
/** A surviving completed Keep is required to muster ranged levies. */
export function levySlingerFraction(state: GameState, factionId = playerFaction(state)): number {
  const faction = state.factions.find(f => f.id === factionId);
  if (!researchLevel(faction, 'massLevy') || !state.buildings.some(b => b.faction === factionId && isKeep(b) && buildingReady(b))) return 0;
  const fraction = faction?.levySlingerFraction ?? 0;
  return Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
}
/** Changes the composition of subsequent drafts; soldiers already in combat keep their roles. */
export function setLevySlingerFraction(state: GameState, keep: Building, fraction: number): boolean {
  const faction = state.factions.find(f => f.id === playerFaction(state));
  if (!faction || state.gameOver || faction.defeated || keep.faction !== faction.id || !state.buildings.includes(keep)
    || !isKeep(keep) || !buildingReady(keep) || !researchLevel(faction, 'massLevy') || !buildingActivityAvailable(state, keep)
    || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return false;
  faction.levySlingerFraction = Math.round(fraction * 100) / 100;
  return true;
}
export const LEVY_ATTACK = 17 / 2;
export const LEVY_DEFENSE = 4 / 2;
export const LEVY_MORALE = 80;
export const LEVY_DRAFT_COST = 15;
export const LEVY_UPKEEP = 5;
export const LEVY_UPKEEP_INTERVAL = 30;
export const LEVY_ACTION_COOLDOWN = 30;
export function levyCooldownRemaining(state: GameState, factionId = playerFaction(state)): number {
  return Math.max(0, (state.factions.find(f => f.id === factionId)?.levyReadyAt ?? 0) - state.time);
}
export interface LevyState {
  original: Pick<Unit, 'kind' | 'attack' | 'defense' | 'speed' | 'range' | 'maxHp' | 'home' | 'builder' | 'collector' | 'collectorCamp' | 'work' | 'armorLevel' | 'weaponLevel'>;
  city?: number;
  nextUpkeepAt: number;
}
export const unitMoraleMaximum = (unit: Pick<Unit, 'kind'>): number => (unit.kind === 'levyInfantry' || unit.kind === 'slinger') ? LEVY_MORALE : 100;
const activeLevies = (state: GameState, faction: number): Unit[] => state.units.filter(unit => (unit.kind === 'levyInfantry' || unit.kind === 'slinger') && unit.faction === faction && unit.hp > 0 && unit.levy);
function musterPoint(state: GameState, unit: Unit): Point | undefined {
  if (unit.resourceWork?.phase === 'working' && canWalk(state, unit.x, unit.y, unit.faction)) return { x: unit.x, y: unit.y };
  if (!unit.inside && canWalk(state, unit.x, unit.y, unit.faction)) return { x: unit.x, y: unit.y };
  const city = workerHomeCity(state, unit);
  return city && constructionEdges(state, city, true).sort((a, b) => distance(a, unit) - distance(b, unit))[0];
}
function candidates(state: GameState, faction: number): Unit[] {
  return withNavigationFrame(state, () => state.units.filter(unit => eligibleWorker(state, unit, faction))
    .sort((a, b) => Number(!!a.builder) - Number(!!b.builder) || a.id - b.id));
}
function eligibleWorker(state: GameState, unit: Unit, faction: number): boolean {
  return unit.faction === faction && unit.kind === 'worker' && unit.hp > 0
    && !unit.civilianPanic && !unit.routed && !unit.builderRetiring && unit.villageId === undefined && !unit.levy && !!musterPoint(state, unit);
}
function workforceCount(state: GameState, faction: number): number {
  // HUD queries run outside the simulation's navigation scope. Validate the
  // building topology once for the whole roster, not once per worker/exit.
  return withNavigationFrame(state, () => {
    let count = 0;
    for (const unit of state.units) if (eligibleWorker(state, unit, faction)) count++;
    return count;
  });
}
interface WorkforceSnapshot {
  time: number; count: number; world: GameState['world']; worldRevision: number | undefined;
  units: number; buildings: number; forbidden: number; diplomacy: string;
}
const displayWorkforces = new WeakMap<GameState, Map<number, WorkforceSnapshot>>();
function displayWorkforceCount(state: GameState, faction: number): number {
  const store = entityStore(state), worldRevision = state.world.revision, forbidden = forbiddenRevision(state, faction);
  const diplomacy = state.factions.map(owner => `${owner.id}:${owner.relation}`).join(';');
  let byFaction = displayWorkforces.get(state);
  if (!byFaction) { byFaction = new Map(); displayWorkforces.set(state, byFaction); }
  const previous = byFaction.get(faction);
  if (previous && state.time >= previous.time && state.time < previous.time + 1
    && previous.world === state.world && previous.worldRevision === worldRevision
    && previous.units === store.units.revision && previous.buildings === store.buildings.revision
    && previous.forbidden === forbidden && previous.diplomacy === diplomacy) return previous.count;
  const count = workforceCount(state, faction);
  byFaction.set(faction, { time: state.time, count, world: state.world, worldRevision,
    units: store.units.revision, buildings: store.buildings.revision, forbidden, diplomacy });
  return count;
}
function status(state: GameState, factionId: number, countWorkforce: () => number): {
  active: number; maximum: number; available: number; draftCost: number; upkeep: number; canLevy: boolean; reason: string; cooldown: number;
} {
  const faction = state.factions.find(candidate => candidate.id === factionId), active = activeLevies(state, factionId).length;
  const maximum = Math.floor(Math.max(0, faction?.population ?? 0) / 3);
  const researched = researchLevel(faction, 'massLevy') > 0;
  const workforce = researched && maximum > active ? Math.min(maximum - active, countWorkforce()) : 0;
  // Leave a positive balance: paying the exact last coin would immediately
  // route the newly mustered soldiers under the normal bankruptcy rule.
  const affordable = Math.max(0, Math.ceil((Math.max(0, faction?.gold ?? 0) - 1e-7) / LEVY_DRAFT_COST) - 1);
  const available = Math.min(workforce, affordable);
  const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === factionId && unit.hp > 0);
  const cooldown = levyCooldownRemaining(state, factionId);
  let reason = '';
  if (state.gameOver || !faction || faction.defeated) reason = 'Your realm can no longer raise a levy.';
  else if (cooldown > 0) reason = `Levy available in ${Math.ceil(cooldown)}s.`;
  else if (!researched) reason = 'Research Mass levy first.';
  else if (!leader || leader.inside || leader.embarkedOn !== undefined || leader.order === 'flee') reason = 'Your Leader must be alive, on land, and rallied.';
  else if (!workforce) reason = active >= maximum ? 'One third of the population is already levied.' : 'No available peasants to levy.';
  else if (!affordable) reason = `Need more than ${LEVY_DRAFT_COST} gold to draft a peasant and retain a positive treasury.`;
  return { active, maximum, available, draftCost: available * LEVY_DRAFT_COST, upkeep: active * LEVY_UPKEEP, canLevy: !reason, reason, cooldown };
}
/** Exact command validation always reads the current workers and exit tiles. */
export function levyStatus(state: GameState, factionId = playerFaction(state)) {
  return status(state, factionId, () => workforceCount(state, factionId));
}
/** Only the HUD's worker availability may lag by one game second. Budget,
 * population, active levy and Leader eligibility remain live, including paused. */
export function levyDisplayStatus(state: GameState, factionId = playerFaction(state)) {
  return status(state, factionId, () => displayWorkforceCount(state, factionId));
}
function clearOrders(unit: Unit): void {
  unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined;
  unit.forcedAttack = undefined; unit.attackReturn = undefined; unit.infantryDrillLeader = undefined; unit.levyAssembling = undefined;
  unit.repathAt = 0; unit.moving = false; unit.cooldown = 0; unit.attackTime = 0;
}
/** Converts the actual workers. Their original civilian jobs and homes survive
 * service, while job budgets reserve these residents until they return. */
export function levyPopulation(state: GameState, requested?: number, factionId = playerFaction(state)): { ok: boolean; message: string; count?: number } {
  const status = levyStatus(state, factionId);
  if (!status.canLevy) return { ok: false, message: status.reason };
  if (requested !== undefined && (!Number.isInteger(requested) || requested <= 0)) return { ok: false, message: 'Choose a positive whole number of peasants.' };
  const count = Math.min(requested ?? status.available, status.available), faction = state.factions.find(candidate => candidate.id === factionId)!;
  const recruits = candidates(state, factionId).slice(0, count);
  // Drafting purchases the first thirty seconds; later service costs less.
  // Dismissing and raising peasants again always charges the draft fee.
  spendGold(state, faction, recruits.length * LEVY_DRAFT_COST, 'army');
  const existing = activeLevies(state, factionId);
  let slingersNeeded = Math.max(0, Math.round((existing.length + recruits.length) * levySlingerFraction(state, factionId))
    - existing.filter(unit => unit.kind === 'slinger').length);
  for (const unit of recruits) {
    const slinger = slingersNeeded-- > 0;
    const healthFraction = Math.min(1, unit.hp / (unit.maxHp ?? 50));
    const point = musterPoint(state, unit)!, city = workerHomeCity(state, unit);
    const { kind, attack, defense, speed, range, maxHp, home, builder, collector, collectorCamp, work, armorLevel, weaponLevel } = unit;
    unit.levy = { original: { kind, attack, defense, speed, range, maxHp, home, builder, collector, collectorCamp, work, armorLevel, weaponLevel },
      city: city?.id, nextUpkeepAt: state.time + LEVY_UPKEEP_INTERVAL };
    releaseCollectorWork(state, unit); releaseAttackSpot(state, unit);
    for (const building of state.buildings) {
      if (building.construction?.builderId === unit.id) {
        const site = building.construction;
        if (!site.waitingForBuilder) site.pausedAt = state.time;
        site.waitingForBuilder = true; site.cleared = false; delete site.builderId; invalidateNavigation(state);
      }
      if (building.repairerId === unit.id) delete building.repairerId;
    }
    for (const order of state.treeClearings ?? []) if (order.workerId === unit.id) delete order.workerId;
    if (unit.resourceWork) {
      const site = state.resourceWorkSites?.find(site => site.roadWorker === unit.id);
      if (site) site.roadWorker = undefined;
      // A drafted resident leaves this short shift; after dismissal it walks
      // home rather than resuming old work from its military position.
      unit.resourceWork.phase = 'returning'; unit.resourceWork.workTarget = undefined; unit.resourceWork.nextPlanAt = undefined;
    }
    unit.buildSite = undefined; unit.repairSite = undefined; unit.clearTree = undefined; unit.clearProgress = undefined;
    unit.buildPhase = undefined; unit.collectPhase = undefined; unit.collectorCamp = undefined; unit.work = undefined;
    entityStore(state).setUnitRole(unit, { kind: slinger ? 'slinger' : 'levyInfantry', builder: false, collector: false });
    Object.assign(unit, point); clearOrders(unit);
    unit.attack = slinger ? SLINGER_ATTACK : LEVY_ATTACK; unit.defense = slinger ? SLINGER_DEFENSE : LEVY_DEFENSE; unit.speed = 3.2; unit.range = slinger ? SLINGER_RANGE : 1.4;
    unit.maxHp = slinger ? SLINGER_HEALTH : maxHp ?? 50; unit.hp = unit.maxHp * healthFraction; unit.morale = LEVY_MORALE; unit.order = 'follow'; unit.inside = false;
    unit.routed = false; unit.routOrder = undefined; unit.joiningRetinue = true;
    unit.retinueStance = 'aggressive'; equipUnitFromFaction(unit, faction);
  }
  faction.levyReadyAt = state.time + LEVY_ACTION_COOLDOWN;
  invalidateSettlementDecisions(state);
  const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === factionId && unit.hp > 0);
  if (leader && recruits.length) announceArmyMobilization(state, leader, 'levy');
  return { ok: true, count: recruits.length, message: `${recruits.length} peasants levied for ${recruits.length * LEVY_DRAFT_COST} gold. Upkeep is ${LEVY_UPKEEP} gold each every ${LEVY_UPKEEP_INTERVAL} seconds.` };
}
function restore(state: GameState, unit: Unit, routed: boolean): void {
  const levy = unit.levy;
  if (!levy) return;
  const { original } = levy;
  const healthFraction = Math.min(1, unit.hp / (unit.maxHp ?? 50));
  releaseAttackSpot(state, unit); clearOrders(unit);
  Object.assign(unit, original); entityStore(state).setUnitRole(unit, { kind: original.kind, builder: original.builder, collector: original.collector });
  // Assigning the kind above precedes the role update, so refresh explicitly.
  entityStore(state).units.updateRoles(unit); entityStore(state).setUnitSleeping(unit, false);
  unit.hp = healthFraction * (unit.maxHp ?? 50); unit.order = 'work'; unit.morale = 100;
  unit.routed = false; unit.routOrder = undefined; unit.joiningRetinue = undefined; unit.retinueStance = undefined;
  unit.buildPhase = original.builder ? 'returning' : undefined; unit.collectPhase = original.collector ? 'returning' : undefined;
  delete unit.levy;
  if (routed && unit.hp > 0) panicCivilian(state, unit, unit);
  invalidateSettlementDecisions(state);
}
export function dismissLevy(state: GameState, factionId = playerFaction(state)): { ok: boolean; message: string } {
  const cooldown = levyCooldownRemaining(state, factionId);
  if (cooldown > 0) return { ok: false, message: `Levy available in ${Math.ceil(cooldown)}s.` };
  const units = activeLevies(state, factionId);
  for (const unit of units) restore(state, unit, false);
  if (units.length) state.factions.find(f => f.id === factionId)!.levyReadyAt = state.time + LEVY_ACTION_COOLDOWN;
  return { ok: !!units.length, message: units.length ? 'Levy dismissed. Peasants are returning to their original jobs.' : 'No active levy.' };
}
/** Called before formations and after expenditure. Bankrupt levies immediately
 * stop fighting and use the ordinary civilian rout home, even between paydays. */
export function updateMassLevy(state: GameState): void {
  const rosters = new Map<number, Unit[]>();
  for (const unit of state.units) if ((unit.kind === 'levyInfantry' || unit.kind === 'slinger') && unit.hp > 0 && unit.levy) {
    const roster = rosters.get(unit.faction) ?? [];
    roster.push(unit); rosters.set(unit.faction, roster);
  }
  if (!rosters.size) return;
  for (const faction of state.factions) {
    const units = rosters.get(faction.id);
    if (!units?.length) continue;
    const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === faction.id && unit.hp > 0);
    let bankrupt = faction.gold <= 0 || faction.defeated || !leader;
    const due = units.filter(unit => state.time + 1e-7 >= unit.levy!.nextUpkeepAt);
    const cost = due.reduce((sum, unit) => sum + (1 + Math.floor((state.time + 1e-7 - unit.levy!.nextUpkeepAt) / LEVY_UPKEEP_INTERVAL)) * LEVY_UPKEEP, 0);
    if (!bankrupt && cost > 0) {
      bankrupt = faction.gold + 1e-7 < cost;
      if (!bankrupt) {
        spendGold(state, faction, cost, 'army');
        for (const unit of due) unit.levy!.nextUpkeepAt += (1 + Math.floor((state.time + 1e-7 - unit.levy!.nextUpkeepAt) / LEVY_UPKEEP_INTERVAL)) * LEVY_UPKEEP_INTERVAL;
        bankrupt = faction.gold <= 1e-7;
      }
    }
    if (bankrupt) for (const unit of units) restore(state, unit, true);
    else {
      const excess = Math.max(0, units.length - Math.floor(faction.population / 3));
      if (excess) for (const unit of units.slice(-excess)) restore(state, unit, false);
      for (const unit of units) unit.morale = Math.min(unitMoraleMaximum(unit), unit.morale);
    }
  }
}
/** Levy soldiers remain residents; death removes the resident once, while
 * voluntary dismissal and bankruptcy never count as casualties. */
export function recordLevyCasualty(state: GameState, unit: Unit): boolean {
  if ((unit.kind !== 'levyInfantry' && unit.kind !== 'slinger') || !unit.levy || unit.hp > 0 || unit.civilianCasualtyRecorded) return false;
  const civilian = { ...unit, kind: 'worker' as const, home: unit.levy.original.home };
  const recorded = recordCivilianCasualty(state, civilian);
  unit.civilianCasualtyRecorded = civilian.civilianCasualtyRecorded;
  return recorded;
}
