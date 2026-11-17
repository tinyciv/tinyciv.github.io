import { entityStore, buildingWithId } from './entity-store';
import { structuresOf, STRUCTURE_ALIVE, STRUCTURE_READY } from './structure-index';
import { nearbyBuildings, nearbyUnits } from './spatial';
import { isHumanFaction, withPlayerFaction } from './player-context';
import { isSoldier } from './types';
import { constructionEdges } from './builders';
import { insideOwnBorders } from './borders';
import { buildingSightRadius, unitSightRadius } from './fog';
import { canWalk, hasStaticPath, travelTimeMap, wallBreachingNavigation, withNavigationFrame } from './pathfinding';
import { buildingReady, buildingWidth, buildingHeight, distance, unitMaxHp, type Building, type GameState, type Point, type Unit } from './types';
import { unitAttack, unitDefense, unitDamageTakenMultiplier } from './veterancy';
import { culturalHomeGround } from './cultural-territory';
import { maximumHighGroundSightMultiplier } from './sight';
import { factionEmpireGoal, factionSiegeGoal } from './faction-empire';
import { factionAIPolicy, factionAIDecision } from './faction-ai-profile';
import { infantryFormationSoldierCount, toggleInfantryFormation } from './infantry-drill';
import { isInfantryDrillUnlocked, researchLevel } from './research';
import { prepareFactionArmy } from './faction-military';
import { dismissLevy, levyPopulation, levyStatus, LEVY_ATTACK, LEVY_DEFENSE, LEVY_MORALE, LEVY_DRAFT_COST, LEVY_UPKEEP } from './mass-levy';
import { factionCommittedBudget } from './faction-budget';
import { cityResidents } from './cities';
import { updateFactionOffensive, offensiveAiTarget } from './offensive-native';

export type FactionMissionMode = 'patrol' | 'hunt' | 'attack' | 'defend' | 'recover' | 'regroup';
export interface FactionMission {
  mode: FactionMissionMode;
  palaceId: number;
  leaderId: number;
  goal: Point;
  /** Only a currently observed target is supplied. A lost contact leaves a
   * last-seen goal for a short search, never live hidden coordinates. */
  targetId?: number;
  escortIds: number[];
  garrisonIds: number[];
}
export interface FactionStrategyQueries {
  hostile: (a: number, b: number) => boolean;
  visible: (observer: Unit | Building, target: Unit | Building) => boolean;
}
interface StrategyMemory {
  policyCode: number;
  nextAt: number;
  mission?: FactionMission;
  recovering?: boolean;
  huntingSince?: number;
  cooldownUntil?: number;
  lastContact?: { id: number; point: Point; at: number };
  patrolIndex: number;
  patrolGoal?: Point;
  patrolUntil?: number;
  regroupSince?: number;
  campaign?: { palaceId: number; goal: Point; until: number; levied?: boolean };
  formationPosition?: { point: Point; at: number };
  formationRetryAt?: number;
  levyLastThreatAt?: number;
}
const strategies = new WeakMap<GameState, Map<number, StrategyMemory>>();
const HUNT_RADIUS = 26;
const SEARCH_SECONDS = 5;
const HUNT_SECONDS = 38;

const center = (building: Building): Point => ({ x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 });
const point = (value: Point): Point => ({ x: value.x, y: value.y });
const available = (unit: Unit): boolean => unit.hp > 0 && !unit.inside && unit.order !== 'raid' && unit.order !== 'flee' && unit.order !== 'hold';
const healthy = (unit: Unit): boolean => unit.hp >= unitMaxHp(unit) * .65 && unit.morale >= 65;

/** Health, morale, armor, veterancy and ranged support all affect the estimate;
 * this does not change actual combat stats or grant a bounty before a kill. */
function strength(state: GameState, unit: Unit): number {
  const faction = state.factions.find(candidate => candidate.id === unit.faction);
  const home = culturalHomeGround(state, faction, unit);
  return unit.hp / unitDamageTakenMultiplier(unit) * (unitAttack(unit, faction, home) + unitDefense(unit, faction, home) * .55)
    * (.5 + Math.max(0, Math.min(100, unit.morale)) / 200) * (unit.range >= 3 ? 1.25 : 1);
}

function visibleEnemies(state: GameState, faction: number, home: Point, leader: Unit, queries: FactionStrategyQueries,
  observers: readonly (Unit | Building)[]): Unit[] {
  const sources = new Map<Unit | Building, { from: Point; radius: number }>();
  let maximumRadius = 0;
  for (const observer of observers) {
    const building = 'capacity' in observer, from = building ? center(observer) : observer;
    const radius = (building ? buildingSightRadius(observer) : unitSightRadius(observer))
      * maximumHighGroundSightMultiplier(state.world, from, !building);
    sources.set(observer, { from, radius }); maximumRadius = Math.max(maximumRadius, radius);
  }
  return state.units.filter(enemy => {
    if (enemy.hp <= 0 || enemy.inside || enemy.attack <= 0 || !queries.hostile(faction, enemy.faction)
      || distance(enemy, home) > HUNT_RADIUS + 9 && distance(enemy, leader) > 12) return false;
    const sees = (observer: Unit | Building): boolean => {
      const source = sources.get(observer);
      return !!source && distance(source.from, enemy) <= source.radius && queries.visible(observer, enemy);
    };
    // The spatial broad phase retains original unit/building order, including
    // the public fallback outside a step. Exact sight and cover checks remain.
    return nearbyUnits(state, enemy, maximumRadius).some(sees)
      || nearbyBuildings(state, enemy, maximumRadius).some(sees);
  });
}

function refuge(state: GameState, palace: Building, leader: Unit, enemies: readonly Unit[]): Point {
  const candidates: Point[] = [];
  for (let dy = -2; dy <= 3; dy++) for (let dx = -2; dx <= 3; dx++) {
    const goal = { x: palace.x + dx + .5, y: palace.y + dy + .5 };
    if (canWalk(state, goal.x, goal.y, leader.faction) && insideOwnBorders(state, leader.faction, goal.x, goal.y)
      && hasStaticPath(state, leader, goal, leader.faction)) candidates.push(goal);
  }
  candidates.sort((a, b) => {
    const score = (goal: Point) => Math.min(8, ...enemies.map(enemy => distance(goal, enemy))) * 2 - distance(goal, leader) * .25;
    return score(b) - score(a);
  });
  // A destroyed/contested border can leave no safe tile; hold a reachable place
  // rather than pathing into the solid palace footprint.
  return candidates[0] ?? point(leader);
}

function patrolGoal(state: GameState, palace: Building, leader: Unit, escorts: Unit[], memory: StrategyMemory, hazards: Point[]): Point {
  const home = center(palace);
  const safe = (goal: Point): boolean => hazards.every(hazard => {
    const dx = goal.x - leader.x, dy = goal.y - leader.y, length = dx * dx + dy * dy;
    const along = length > 0 ? Math.max(0, Math.min(1, ((hazard.x - leader.x) * dx + (hazard.y - leader.y) * dy) / length)) : 0;
    const closest = { x: leader.x + dx * along, y: leader.y + dy * along };
    return distance(closest, hazard) >= 5;
  });
  if (memory.patrolGoal && state.time < (memory.patrolUntil ?? 0) && distance(leader, memory.patrolGoal) > 1
    && safe(memory.patrolGoal) && hasStaticPath(state, leader, memory.patrolGoal, leader.faction)) return memory.patrolGoal;
  for (let attempt = 0; attempt < 16; attempt++) {
    const index = memory.patrolIndex++;
    // A small force stays home. Escorted patrols scout the approaches, returning
    // inward regularly, so raiders can be found without global knowledge.
    const radius = escorts.length < 2 ? 4 : index % 3 === 2 ? 5 : 12;
    const angle = (leader.faction - 1) * Math.PI / 2 + index * Math.PI / 4;
    const goal = { x: Math.floor(home.x + Math.cos(angle) * radius) + .5,
      y: Math.floor(home.y + Math.sin(angle) * radius) + .5 };
    if (!safe(goal) || !canWalk(state, goal.x, goal.y, leader.faction) || !hasStaticPath(state, leader, goal, leader.faction)) continue;
    memory.patrolGoal = goal; memory.patrolUntil = state.time + 16;
    return goal;
  }
  return refuge(state, palace, leader, []);
}

function plan(state: GameState, leader: Unit, palace: Building, memory: StrategyMemory, queries: FactionStrategyQueries): FactionMission {
  const home = center(palace), previous = memory.mission;
  const policy = factionAIPolicy(state, leader.faction);
  const decide = (decision: Parameters<typeof factionAIDecision>[2], ...values: number[]) => factionAIDecision(state, leader.faction, decision, ...values);
  const army = entityStore(state).units.query('soldier').filter(unit => unit.faction === leader.faction && isSoldier(unit) && unit.kind !== 'skirmisher'
    && unit.guardPost === undefined && available(unit));
  const ready = army.filter(unit => healthy(unit) && (!unit.joiningRetinue || unit.levy || distance(unit, leader) <= 5));
  // Keep a real garrison, including wounded troops. Stable assignments avoid
  // rotating the entire escort whenever two soldiers pass one another.
  const homeTowers = structuresOf(state, leader.faction, STRUCTURE_READY, 'woodenTower', 'tower', 'fort')
    .filter(building => distance(building, home) <= 12);
  // A fortified town already has a standing garrison. Keep the professional
  // army together; wounded troops still recover at home instead of marching.
  const reserved = decide('garrison', ready.length, army.length, homeTowers.length);
  const previousGarrison = new Set(previous?.garrisonIds);
  ready.sort((a, b) => Number(previousGarrison.has(b.id)) - Number(previousGarrison.has(a.id))
    || distance(a, home) - distance(b, home) || a.id - b.id);
  const garrison = new Set(ready.slice(0, reserved).map(unit => unit.id));
  const escorts = ready.filter(unit => !garrison.has(unit.id));
  const escortIds = escorts.map(unit => unit.id), escortSet = new Set(escortIds);
  const garrisonIds = army.filter(unit => !escortSet.has(unit.id)).map(unit => unit.id);
  const observerRoster = (): (Unit | Building)[] => [
    ...state.units.filter(unit => unit.faction === leader.faction && unit.hp > 0 && !unit.inside),
    ...structuresOf(state, leader.faction, STRUCTURE_READY),
  ];
  let observers = observerRoster();
  const observerRevision = entityStore(state).units.revision;
  const enemies = visibleEnemies(state, leader.faction, home, leader, queries, observers);
  const closeEnemies = enemies.filter(enemy => distance(enemy, leader) <= 7);
  const supporting = [leader, ...army.filter(unit => distance(unit, leader) <= 8)];
  const hostileBatteries = policy.features.towerAwareness ? structuresOf(state, undefined, STRUCTURE_READY, 'woodenTower', 'tower', 'fort')
    .filter(building => queries.hostile(leader.faction, building.faction)
    && distance(center(building), leader) <= 8 && queries.visible(leader, building)) : [];
  const enemyPower = decide('hostilePower', closeEnemies.reduce((sum, enemy) => sum + strength(state, enemy), 0),
    hostileBatteries.filter(tower => tower.kind !== 'fort').length, hostileBatteries.filter(tower => tower.kind === 'fort').length);
  const friendlyPower = decide('friendlyPower', supporting.reduce((sum, unit) => sum + strength(state, unit), 0),
    homeTowers.filter(tower => distance(center(tower), leader) <= 6).length);
  const endangered = decide('retreat', leader.hp, unitMaxHp(leader), leader.morale, enemyPower, friendlyPower, distance(leader, home));
  const make = (mode: FactionMissionMode, goal: Point, targetId?: number): FactionMission =>
    ({ mode, palaceId: palace.id, leaderId: leader.id, goal: point(goal), targetId, escortIds, garrisonIds });

  const faction = state.factions.find(candidate => candidate.id === leader.faction)!;
  const abandonCampaign = (): void => {
    if (!memory.campaign) return;
    if (memory.campaign.levied) memory.levyLastThreatAt = state.time;
    memory.campaign = undefined;
    faction.nextRaid = Math.max(faction.nextRaid, state.time + policy.parameters.campaignCooldown);
  };
  if (endangered) { memory.recovering = true; abandonCampaign(); }
  if (memory.recovering) {
    if (decide('recovered', leader.hp, unitMaxHp(leader), leader.morale, enemyPower, friendlyPower, distance(leader, home)))
      memory.recovering = false;
    else {
      memory.huntingSince = undefined; memory.lastContact = undefined;
      memory.cooldownUntil = state.time + 8;
      return make('recover', refuge(state, palace, leader, enemies));
    }
  }

  const homeThreats = enemies.filter(enemy => distance(enemy, home) <= 11 && hasStaticPath(state, leader, enemy, leader.faction));
  homeThreats.sort((a, b) => distance(a, home) - distance(b, home) || a.id - b.id);
  const attacked = structuresOf(state, leader.faction, STRUCTURE_ALIVE)
    .some(building => state.time - (building.lastAttacked ?? -Infinity) < 8);
  if (homeThreats.length || attacked) {
    abandonCampaign();
    memory.huntingSince = undefined; memory.lastContact = undefined; memory.regroupSince = undefined;
    if (policy.features.defensiveLevy && researchLevel(faction, 'massLevy') && homeThreats.length >= 3) {
      memory.levyLastThreatAt = state.time;
      const status = levyStatus(state, faction.id);
      // Two wage periods plus an emergency treasury remain available. Civilians
      // return to their real jobs after the local danger has been absent awhile.
      const count = Math.min(status.available, Math.max(0, Math.floor((faction.gold - 100) / (LEVY_DRAFT_COST + LEVY_UPKEEP))));
      if (status.canLevy && !status.active && count > 0)
        withPlayerFaction(state, faction.id, () => levyPopulation(state, count));
    }
    const target = homeThreats[0];
    return make('defend', target ?? refuge(state, palace, leader, enemies), target?.id);
  }

  if ((policy.features.defensiveLevy || policy.features.campaignLevy) && !memory.campaign && memory.levyLastThreatAt !== undefined && state.time - memory.levyLastThreatAt >= 15 && !closeEnemies.length) {
    withPlayerFaction(state, faction.id, () => dismissLevy(state, faction.id)); memory.levyLastThreatAt = undefined;
  }

  // The diplomacy ECS assigns bounded allied defense objectives. The normal
  // army planner retains home emergencies, retreat and path feasibility.
  const assistance = state.diplomacyState?.assistance[leader.faction];
  if (assistance && assistance.until > state.time) {
    const allyCity = entityStore(state).buildings.get(assistance.city);
    if (allyCity && allyCity.faction === assistance.ally && buildingReady(allyCity)) {
      const approach = constructionEdges(state, allyCity).find(point => hasStaticPath(state, leader, point, leader.faction));
      if (approach) { abandonCampaign(); return make('defend', approach); }
    }
  }

  const service = prepareFactionArmy(state, leader, palace);
  if (service && !memory.campaign && !closeEnemies.length) return make('patrol', service);

  const campaignMission = (): FactionMission | undefined => {
    const campaign = memory.campaign;
    if (!campaign) return;
    const target = buildingWithId(state, campaign.palaceId, building => buildingReady(building)
      && queries.hostile(leader.faction, building.faction));
    if (!target || state.time >= campaign.until || escorts.length < 2) {
      abandonCampaign(); memory.recovering = true;
      return make('recover', refuge(state, palace, leader, enemies));
    }
    // Cities are strategic destinations, but combat uses actual sight. The
    // army waits for stragglers instead of sending individual raiders ahead.
    const targetId = queries.visible(leader, target) ? target.id : undefined;
    if (escorts.filter(unit => distance(unit, leader) <= 7).length < Math.ceil(escorts.length * .7))
      return make('regroup', leader, targetId);
    if (policy.features.interceptEnemies && closeEnemies.length) {
      // Fight the intercepting army before marching through it toward a city.
      // A stable nearest contact keeps the formation's front on the battle.
      const contact = closeEnemies.find(enemy => enemy.id === previous?.targetId)
        ?? closeEnemies.slice().sort((a, b) => distance(a, leader) - distance(b, leader) || a.id - b.id)[0];
      return make('attack', contact, contact.id);
    }
    const expedition = factionEmpireGoal(state,leader.faction);
    if (expedition?.kind === 2) return make('attack',expedition.point);
    const defenses = nearbyBuildings(state,target,12)
      .filter(building=>buildingReady(building)&&['palisade','wall','woodenTower','tower','fort'].includes(building.kind)&&queries.hostile(leader.faction,building.faction)&&distance(building,target)<=10
        &&observers.some(observer=>queries.visible(observer,building))).length;
    const siege = factionSiegeGoal(state,leader.faction,target,defenses);
    if(siege) return make('attack',siege);
    return make('attack', campaign.goal, targetId);
  };
  const underway = campaignMission();
  if (underway) return underway;
  const expedition = factionEmpireGoal(state,leader.faction);
  if(expedition && !closeEnemies.length) return make('patrol',expedition.point);

  const huntExpired = memory.huntingSince !== undefined && state.time - memory.huntingSince > HUNT_SECONDS;
  if (huntExpired || distance(leader, home) > HUNT_RADIUS) {
    memory.huntingSince = undefined; memory.lastContact = undefined;
    memory.cooldownUntil = state.time + 10; memory.patrolGoal = undefined;
    memory.recovering = true;
    return make('recover', refuge(state, palace, leader, enemies));
  }
  if (state.time < (memory.cooldownUntil ?? 0) && distance(leader, home) > 6)
    return make('patrol', refuge(state, palace, leader, enemies));

  // A patrol must contest nearby hostile troops before picking another safe
  // waypoint. Bounty hunts below intentionally select only marauders; applying
  // that restriction to local encounters left human enemies free to follow
  // the army just outside the Leader's weapon range without being challenged.
  // Sensing and reachability remain on the shared one-second planning clock.
  // Recovery, home defense and a hunt's return deadline keep priority.
  const contact = closeEnemies.slice().sort((a, b) => Number(b.id === previous?.targetId) - Number(a.id === previous?.targetId)
    || distance(a, leader) - distance(b, leader) || a.id - b.id)
    .find(enemy => hasStaticPath(state, leader, enemy, leader.faction));
  if (contact) {
    memory.regroupSince = undefined;
    return make('attack', contact, contact.id);
  }

  const force = [leader, ...escorts], power = force.reduce((sum, unit) => sum + strength(state, unit), 0);
  // Army preparation may change civilian/military roles in this very plan.
  // Reuse observers only while their source roster remains authoritative.
  if (entityStore(state).units.revision !== observerRevision) observers = observerRoster();
  const towers = structuresOf(state, undefined, STRUCTURE_READY, 'tower', 'woodenTower')
    .filter(building => queries.hostile(leader.faction, building.faction)
    && distance(center(building), home) <= HUNT_RADIUS + 9
    && observers.some(observer => queries.visible(observer, building))).map(center);
  const candidates = healthy(leader) && escorts.length >= 2 && state.time >= (memory.cooldownUntil ?? 0)
    ? enemies.filter(enemy => enemy.faction === -2 && distance(enemy, home) <= HUNT_RADIUS
      && hasStaticPath(state, leader, enemy, leader.faction)) : [];
  const scores = candidates.map(target => {
    // Count every observed foe near the prize, not only the cheap target at the
    // front of a much stronger group. Enemy towers make a bounty hunt a siege.
    const group = enemies.filter(enemy => distance(enemy, target) <= 7);
    const opposition = group.reduce((sum, enemy) => sum + strength(state, enemy), 0);
    const fortified = towers.some(tower => distance(tower, target) <= 7);
    if (!decide('hunt', power, opposition, Number(fortified))) return { target, score: -Infinity };
    const reward = group.reduce((sum, enemy) => sum + (enemy.marauderLeader ? 50 : 8), 0);
    const continuity = memory.lastContact?.id === target.id ? 8 : 0;
    const score = factionAIDecision(state, leader.faction, 'huntRank', reward, distance(leader, target), opposition, power, target.marauderLeader ? 1 : 0, continuity);
    return { target, score };
  }).sort((a, b) => b.score - a.score || a.target.id - b.target.id);
  const target = scores[0]?.score > -Infinity ? scores[0].target : undefined;

  if (target) {
    memory.lastContact = { id: target.id, point: point(target), at: state.time };
    memory.huntingSince ??= state.time;
    const close = escorts.filter(unit => distance(unit, leader) <= 6);
    if (close.length < Math.max(2, Math.ceil(escorts.length * .7))) {
      memory.regroupSince ??= state.time;
      if (state.time - memory.regroupSince > 10) {
        memory.huntingSince = undefined; memory.lastContact = undefined; memory.regroupSince = undefined;
        memory.cooldownUntil = state.time + 10;
        memory.recovering = true;
        return make('recover', refuge(state, palace, leader, enemies));
      }
      return make('regroup', leader, target.id);
    }
    memory.regroupSince = undefined;
    return make('hunt', target, target.id);
  }

  const lastContact = memory.lastContact;
  if (lastContact && state.time - lastContact.at <= SEARCH_SECONDS && escorts.length >= 2
    && !enemies.some(enemy => enemy.id === lastContact.id)
    && distance(leader, lastContact.point) > 1 && hasStaticPath(state, leader, lastContact.point, leader.faction))
    return make('hunt', lastContact.point);
  const finishedHunt = memory.huntingSince !== undefined;
  memory.lastContact = undefined; memory.huntingSince = undefined; memory.regroupSince = undefined;
  if (finishedHunt && distance(leader, home) > 6) {
    memory.recovering = true; memory.cooldownUntil = state.time + 8;
    return make('recover', refuge(state, palace, leader, enemies));
  }
  if (healthy(leader) && escorts.length >= 2 && state.time >= faction.nextRaid && state.time >= (memory.cooldownUntil ?? 0)) {
    // One strategic departure clock belongs to the Leader. Wilderness raider
    // archetypes and their independent wave schedules never control factions.
    faction.nextRaid = state.time + policy.parameters.campaignCooldown;
    const targets = state.buildings.filter(building => building.kind === 'palace' && buildingReady(building)
      && queries.hostile(leader.faction, building.faction));
    // Strategic planning may breach enemy walls. Water and ledges remain real
    // obstacles, so isolated islands never attract an impossible land campaign.
    const planning = wallBreachingNavigation(state, { kind: 'faction', faction: leader.faction,
      hostile: owner => queries.hostile(leader.faction, owner) });
    const populations = new Map(cityResidents(state).map(city => [city.palace.id, city.population]));
    const levy = policy.features.campaignLevy ? levyStatus(state, faction.id) : undefined;
    const worker = state.units.find(unit => unit.faction === faction.id && unit.kind === 'worker' && unit.hp > 0);
    const levyPower = worker ? strength(state, { ...worker, kind: 'levyInfantry', attack: LEVY_ATTACK, defense: LEVY_DEFENSE,
      morale: LEVY_MORALE, range: 1.4, weaponLevel: faction.weaponLevel, armorLevel: faction.armorLevel }) : 0;
    const reserve = 100 + factionCommittedBudget(state, faction).upkeep * 2;
    const ranked = targets.length ? withNavigationFrame(planning, () => {
      const travel = travelTimeMap(planning, leader, leader.faction, leader.speed, Infinity);
      return targets.map(target => {
        const seconds = Math.min(Infinity, ...constructionEdges(planning, target)
          .map(entrance => travel[Math.floor(entrance.y) * state.world.width + Math.floor(entrance.x)]));
        // Only observed defenses enter the estimate. An unseen city remains a
        // scouting objective; its hidden garrison never leaks into decisions.
        const defending = enemies.filter(enemy => distance(enemy, center(target)) <= 10)
          .reduce((sum, enemy) => sum + strength(state, enemy), 0);
        const batteries = state.buildings.filter(building => buildingReady(building)
          && ['tower', 'woodenTower', 'fort'].includes(building.kind) && queries.hostile(leader.faction, building.faction)
          && distance(building, target) <= 10 && observers.some(observer => queries.visible(observer, building))).length;
        // Population is a strategic estimate of a city's ability to mobilize,
        // never a lookup of hidden soldiers' positions or current health.
        const population = populations.get(target.id) ?? 0;
        const danger = Math.max(defending, population * 35) + batteries * 1600;
        const wagePeriods = Math.ceil((seconds * 2 + 90) / 30);
        const affordable = Math.max(0, Math.floor((faction.gold - reserve) / (LEVY_DRAFT_COST + wagePeriods * LEVY_UPKEEP)));
        const available = levy?.canLevy && !levy.active ? Math.min(levy.available, affordable) : 0;
        const required = decide('requiredLevy', danger, power, levyPower);
        // A population advantage can support a small expeditionary levy even
        // before defenses have all been observed. Avoid drafting the whole town.
        const desired = population < faction.population * .8 ? Math.max(required, Math.min(6, Math.floor((faction.population - population) / 10))) : required;
        const draft = Math.min(available, desired);
        return { target, seconds, danger, draft, projected: power + draft * levyPower, rank: decide('campaignRank', seconds, danger, power) };
      }).filter(candidate => Number.isFinite(candidate.seconds) && decide('campaign', candidate.danger, candidate.projected))
        .sort((a, b) => a.rank - b.rank);
    }) : [];
    for (const { target, seconds, draft } of ranked) {
      const levied = draft > 0 && withPlayerFaction(state, faction.id, () => levyPopulation(state, draft)).ok;
      if (draft && !levied) continue;
      if (levied) for (const unit of state.units) if (unit.faction === faction.id && unit.levy && unit.hp > 0 && !escortIds.includes(unit.id)) {
        escorts.push(unit); escortIds.push(unit.id);
      }
      memory.campaign = { palaceId: target.id, goal: center(target), until: state.time + decide('campaignDuration',seconds), levied };
      const mission = campaignMission();
      if (mission) return mission;
    }
  }
  // Scouting also waits for its escort instead of pulling the Leader alone
  // into unexplored ground while recruits remain behind at the palace.
  if (escorts.length >= 2 && escorts.filter(unit => distance(unit, leader) <= 7).length < Math.ceil(escorts.length * .7))
    return make('regroup', leader);
  return make('patrol', patrolGoal(state, palace, leader, escorts, memory, [...enemies, ...towers]));
}

/** Strategic sensing is throttled; callers still use live visibility/contact
 * checks before firing or chasing the returned objective. */
export function updateFactionStrategies(state: GameState, queries: FactionStrategyQueries): void {
  let memories = strategies.get(state);
  if (!memories) { memories = new Map(); strategies.set(state, memories); }
  for (const faction of state.factions) {
    if ((faction.id <= 0 || isHumanFaction(state, faction.id)) || faction.villageId !== undefined || faction.defeated || faction.relation === 'confederated') { memories.delete(faction.id); continue; }
    const store = entityStore(state);
    const leader = store.units.query('leader').find(unit => unit.faction === faction.id && unit.hp > 0);
    if (!leader || leader.order === 'hold' || leader.forcedAttack) { memories.delete(faction.id); continue; }
    let memory = memories.get(faction.id);
    const policy = factionAIPolicy(state, faction.id);
    if (memory && memory.policyCode !== policy.code) { memories.delete(faction.id); memory = undefined; }
    const emergency = memory?.mission?.mode !== 'recover' && !!factionAIDecision(state, faction.id, 'emergency', leader.hp, unitMaxHp(leader), leader.morale);
    // The offensive has its own native planning clock; resolve the indexed
    // home before the generic mission timer can defer a new launch.
    const palaces = store.buildings.query('palace').filter(building => building.faction === faction.id && buildingReady(building));
    const palace = palaces.find(building => building.id === leader?.home)
      ?? palaces.sort((a, b) => distance(a, leader ?? a) - distance(b, leader ?? b))[0];
    if (!palace) { memories.delete(faction.id); continue; }
    if (!memory) { memory = { policyCode: policy.code, nextAt: -Infinity, patrolIndex: 0 }; memories.set(faction.id, memory); }
    const offensive = updateFactionOffensive(state, faction, leader, palace, queries.visible);
    if (offensive) {
      memory.campaign = undefined; memory.recovering = false; memory.huntingSince = undefined; memory.lastContact = undefined;
      memory.regroupSince = undefined; memory.formationPosition = undefined;
      memory.nextAt = state.time + policy.parameters.decisionInterval;
      // The native offensive owns the soldiers. The existing patrol transport
      // moves only the supporting Leader and permits immediate self-defense.
      memory.mission = { mode: 'patrol', palaceId: palace.id, leaderId: leader.id, goal: offensive.goal, escortIds: [], garrisonIds: [] };
      leader.destination = undefined;
      commandFormation(state, leader, memory, queries);
      continue;
    }
    if (state.time < memory.nextAt && !emergency && memory.mission?.leaderId === leader.id && memory.mission.palaceId === palace.id) continue;
    memory.nextAt = state.time + policy.parameters.decisionInterval;
    memory.mission = plan(state, leader, palace, memory, queries);
    commandFormation(state, leader, memory, queries);
  }
}

/** AI issues the same researched formation command as a human. Destinations
 * stop at reachable attack ground, not inside a solid palace. If a breach or
 * narrow exit prevents marching, release ranks and let ordinary siege paths
 * clear it before reforming; this also avoids permanent straggler deadlocks. */
function commandFormation(state: GameState, leader: Unit, memory: StrategyMemory, queries: FactionStrategyQueries): void {
  if (state.offensives?.some(order => order.faction === leader.faction && order.phase !== 'captured')) {
    if (leader.infantryFormation?.active) {
      leader.infantryFormation.active = false;
      for (const unit of entityStore(state).units.query('soldier')) if (unit.infantryDrillLeader === leader.id) unit.infantryDrillLeader = undefined;
    }
    return;
  }
  const mission = memory.mission!, faction = state.factions.find(candidate => candidate.id === leader.faction);
  const count = infantryFormationSoldierCount(state, leader.faction);
  const shouldForm = factionAIDecision(state, leader.faction, 'formation', Number(isInfantryDrillUnlocked(faction)),
    Number(['attack', 'hunt', 'defend'].includes(mission.mode)), count, Number(!!leader.infantryFormation?.active), state.time, memory.formationRetryAt ?? 0);
  const release = (): void => {
    if (leader.infantryFormation?.active) withPlayerFaction(state, leader.faction, () => toggleInfantryFormation(state));
    leader.destination = undefined; memory.formationPosition = undefined;
  };
  if (!shouldForm) { if (leader.infantryFormation?.active) release(); return; }
  let goal = mission.goal;
  const targetUnit = mission.targetId === undefined ? undefined : state.units.find(unit => unit.id === mission.targetId && unit.hp > 0);
  const objective = mission.targetId === undefined ? undefined
    : buildingWithId(state, mission.targetId, buildingReady);
  const targetBuilding = objective ?? state.buildings.find(building => buildingReady(building)
    && building.kind === 'palace' && queries.hostile(leader.faction, building.faction) && distance(center(building), goal) < 1);
  if (targetBuilding) {
    const approaches = constructionEdges(state, targetBuilding).filter(point => hasStaticPath(state, leader, point, leader.faction))
      .sort((a, b) => distance(leader, a) - distance(leader, b));
    if (!approaches.length) {
      release(); memory.formationRetryAt = state.time + 5; return;
    }
    goal = approaches[0];
  } else if (targetUnit && factionAIPolicy(state, leader.faction).features.formationApproach) {
    const gap = distance(leader, targetUnit), advance = Math.max(0, gap - 1.8);
    goal = gap > 0 ? { x: leader.x + (targetUnit.x - leader.x) * advance / gap,
      y: leader.y + (targetUnit.y - leader.y) * advance / gap } : point(leader);
  }
  if (!hasStaticPath(state, leader, goal, leader.faction)) {
    release(); memory.formationRetryAt = state.time + 5; return;
  }
  if (!leader.infantryFormation?.active) withPlayerFaction(state, leader.faction, () => toggleInfantryFormation(state));
  if (!leader.infantryFormation?.active) return;
  // The drill system controls every eligible professional soldier. Do not also
  // give those same soldiers contradictory home-garrison orders.
  mission.escortIds = entityStore(state).units.query('soldier').filter(unit => unit.faction === leader.faction && isSoldier(unit) && unit.kind !== 'skirmisher'
    && unit.hp > 0 && !unit.inside && unit.order !== 'flee' && !unit.training).map(unit => unit.id);
  mission.garrisonIds = [];
  leader.destination = point(goal);
  const position = memory.formationPosition;
  if (!position || distance(position.point, leader) > 1) memory.formationPosition = { point: point(leader), at: state.time };
  else if (state.time - position.at > 10 && distance(leader, goal) > 3 && state.time - leader.lastCombat > 3) {
    release(); memory.formationRetryAt = state.time + 8;
  }
}

export function getFactionStrategy(state: GameState, faction: number): FactionMission | undefined {
  return strategies.get(state)?.get(faction)?.mission;
}

/** A treaty transition cancels stale campaigns immediately. */
export function invalidateFactionStrategies(state: GameState): void { strategies.delete(state); }

/** Public strategic objective, independent of the currently intercepted troop. */
export function getFactionCampaignTarget(state:GameState,faction:number):number|undefined {
  return offensiveAiTarget(state, faction) ?? strategies.get(state)?.get(faction)?.campaign?.palaceId;
}
