import { entityStore, buildingWithId } from './entity-store';
import { raiderMayAttack, provokeRaiderCamp } from './raider-aggression';
import { simRandom } from './sim-handle';
import { banditIntensity, banditPopulationCap, banditSpawnDeadline } from './bandit-intensity';
import { canRallyFromRout, MARAUDER_MAX_MORALE } from './battle-morale';
import { constructionEdges } from './builders';
import { canMove, canWalk, hasStaticPath } from './pathfinding';
import { fogRaidProfile } from './fog-raids';
import { campSpawnTiles, MAX_LIVE_RAIDERS, RAIDER_COLOR, raiderCampActive, raiderCampPartySize, raiderCampPopulationCap, raiderCampRefuge } from './raider-camps';
import { ensureMarauderLeaders } from './marauder-leaders';
import { marauderBaseStats, raiderPartySize } from './raider-pressure';
import { setSoldierRole } from './archery';
import { selectRaidTarget } from './raid-targeting';
import { refreshEarlyCombatUnit } from './spatial';
import { directedFactions, raidDirectorOpen, raidEquipment, raidEra } from './raid-director';
import { buildingReady, buildingWidth, buildingHeight, distance, type Building, type GameState, type MarauderPack, type Point, type RaiderCamp, type Unit } from './types';

export const RAIDER_CAMP_RESERVES = 30;
export const RAIDER_DEFENDER_COOLDOWN = 30;
const planningAt = new WeakMap<GameState, number>();
const shelterJourneys = new WeakMap<Unit, { camp: number; house: Building; exit: Point; revision: number; until: number }>();
const center = (building: Building): Point => ({ x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 });
const edgeDistance = (point: Point, building: Building): number => Math.hypot(Math.max(building.x - point.x, 0, point.x - building.x - buildingWidth(building)),
  Math.max(building.y - point.y, 0, point.y - building.y - buildingHeight(building)));
const membersOf = (state: GameState, pack: MarauderPack): Unit[] => state.units.filter(unit => unit.hp > 0 && unit.marauderPack === pack.id);
const clearOrders = (unit: Unit): void => {
  unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined;
  unit.repathAt = 0; unit.moving = false; unit.attackTime = 0;
};

function reserveExit(state: GameState, unit: Unit): Point | undefined {
  const building = buildingWithId(state, unit.raiderGarrison);
  if (!building) return canWalk(state, unit.x, unit.y, -2) ? { x: unit.x, y: unit.y } : undefined;
  const occupied = new Set(state.units.filter(other => other.hp > 0 && !other.inside && other.id !== unit.id)
    .map(other => `${Math.floor(other.x)},${Math.floor(other.y)}`));
  return constructionEdges(state, building).find(point => canWalk(state, point.x, point.y, -2)
    && !occupied.has(`${Math.floor(point.x)},${Math.floor(point.y)}`))
    ?? (building.hp <= 0 && canWalk(state, unit.x, unit.y, -2) ? { x: unit.x, y: unit.y } : undefined);
}
export function canReleaseRaiderReserve(state: GameState, unit: Unit): boolean {
  return canRallyFromRout(state, unit) && (!unit.inside || !!reserveExit(state, unit));
}
/** Reserves emerge at the actual building door, keeping wounds and experience. */
export function releaseRaiderReserve(state: GameState, unit: Unit, evacuating = false): boolean {
  const canRally = canRallyFromRout(state, unit);
  if (!canRally && !evacuating) return false;
  if (unit.inside) {
    const exit = reserveExit(state, unit); if (!exit) return false;
    unit.x = exit.x; unit.y = exit.y;
  }
  unit.inside = false; delete unit.raiderGarrison;
  refreshEarlyCombatUnit(state, unit);
  entityStore(state).setUnitSleeping(unit, false);
  // Losing a shelter still forces a physical exit, never an early rally.
  if (!canRally) { clearOrders(unit); unit.order = 'flee'; unit.routed = true; return true; }
  clearOrders(unit); unit.order = 'raid'; unit.routed = false; unit.marauderRetreating = false; unit.morale = Math.max(60, unit.morale);
  unit.routUntil = undefined; unit.routOrder = undefined;
  return true;
}

function assignParty(state: GameState, target: Building, units: Unit[], origin: Point, camp?: RaiderCamp, defense = false): MarauderPack {
  const id = Math.max(0, ...(state.marauderPacks ?? []).map(pack => pack.id), ...state.units.map(unit => unit.marauderPack ?? 0)) + 1;
  const pack: MarauderPack = { id, name: defense ? `${camp?.name ?? 'Camp'} defenders` : 'Marauder raiding party', color: RAIDER_COLOR,
    targetFaction: target.faction, targetBuilding: target.id, home: camp ? raiderCampRefuge(camp) : { ...origin }, waypoint: center(target), nextWanderAt: state.time,
    raid: true, microRaid: !defense, campDefense: defense, raiderCamp: camp?.id, motivation: 'assault', spawnedAt: state.time,
    startingTroops: Math.max(0, units.length - 1), leaderId: units.find(unit => unit.marauderLeader)?.id,
    lastProgressAt: state.time, progressPosition: { ...origin }, defenseUntil: defense ? state.time + 30 : undefined };
  (state.marauderPacks ??= []).push(pack);
  for (const unit of units) { unit.marauderPack = id; clearOrders(unit); unit.order = 'raid'; unit.routed = false; unit.marauderRetreating = false; }
  ensureMarauderLeaders(state);
  return pack;
}
function recruit(state: GameState, points: readonly Point[], era: number, defense = false): Unit[] {
  const profile = fogRaidProfile(era), equipment = raidEquipment(era);
  const defenderMinimum = marauderBaseStats(55, 8, 0);
  return points.map((point, index) => {
    const unit: Unit = { id: entityStore(state).allocateId(), kind: 'warrior', faction: -2, ...point,
      hp: defense ? Math.max(defenderMinimum.hp, profile.hp) : profile.hp, maxHp: defense ? Math.max(defenderMinimum.hp, profile.hp) : profile.hp,
      attack: defense ? Math.max(defenderMinimum.attack, profile.attack) : profile.attack, defense: profile.defense,
      morale: MARAUDER_MAX_MORALE, speed: 2.35, range: 1.1, order: 'raid', cooldown: 0, lastCombat: -60, lastDamagedAt: -60,
      moving: false, facing: 0, attackTime: 0, bornAt: state.time, raiderEquipmentMultiplier: equipment };
    // Retain two-thirds of the former archer assignments across small parties.
    if (defense && index % 3 === 1 && simRandom(state) < 2 / 3) setSoldierRole(unit, 'archer');
    entityStore(state).units.add(unit); return unit;
  });
}
function campReserves(state: GameState, camp: RaiderCamp): Unit[] {
  const eligible = new Map((state.marauderPacks ?? []).filter(pack => pack.raiderCamp === camp.id).map(pack => [pack.id, pack]));
  return state.units.filter(unit => unit.hp > 0 && eligible.has(unit.marauderPack ?? -1)
    && (unit.inside || eligible.get(unit.marauderPack ?? -1)?.returning && distance(unit, { x: camp.gate.x + .5, y: camp.gate.y + .5 }) < 4)
    && (unit.stolenGold ?? 0) === 0)
    .sort((a, b) => Number(!!b.marauderLeader) - Number(!!a.marauderLeader) || (b.kills ?? 0) - (a.kills ?? 0) || a.id - b.id);
}
function defenderSpawnTiles(state: GameState, building: Building, attacker: Point, count: number): Point[] {
  const occupied = new Set(state.units.filter(unit => unit.hp > 0 && !unit.inside)
    .map(unit => `${Math.floor(unit.x)},${Math.floor(unit.y)}`));
  const edges = constructionEdges(state, building).filter(point => canWalk(state, point.x, point.y, -2))
    .sort((a, b) => distance(a, attacker) - distance(b, attacker));
  const points: Point[] = [], queue = [...edges], seen = new Set<string>();
  for (let index = 0; index < queue.length && points.length < count; index++) {
    const point = queue[index], key = `${Math.floor(point.x)},${Math.floor(point.y)}`;
    if (seen.has(key) || edgeDistance(point, building) > 3 || !canWalk(state, point.x, point.y, -2)) continue;
    seen.add(key);
    if (!occupied.has(key) && edgeDistance(point, building) > 0) points.push(point);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: point.x + dx, y: point.y + dy };
      if (canMove(state, point, next, -2)) queue.push(next);
    }
  }
  return points;
}
function takeCampParty(state: GameState, camp: RaiderCamp, size: number, era: number, defense = false,
  attackedBuilding?: Building, attacker?: Point): Unit[] {
  const minimum = defense ? raiderPartySize(2, state.time) : 1;
  size = defense ? Math.max(minimum, raiderCampPartySize(state, camp, size)) : raiderCampPartySize(state, camp, size);
  const units: Unit[] = [], previous = new Map<Unit, Unit>();
  const reserves = campReserves(state, camp);
  if (attackedBuilding) reserves.sort((a, b) => Number(b.raiderGarrison === attackedBuilding.id) - Number(a.raiderGarrison === attackedBuilding.id));
  for (const reserve of reserves) {
    if (units.length >= size) break;
    if (reserve.marauderLeader && (defense || units.some(unit => unit.marauderLeader))) continue;
    const before = { ...reserve };
    if (!releaseRaiderReserve(state, reserve)) continue;
    reserve.raiderEquipmentMultiplier = raidEquipment(era);
    previous.set(reserve, before); units.push(reserve);
  }
  const packs = new Set((state.marauderPacks ?? []).filter(pack => pack.raiderCamp === camp.id).map(pack => pack.id));
  const live = state.units.filter(unit => unit.hp > 0 && unit.faction === -2);
  const capacity = Math.max(0, Math.min(banditPopulationCap(state, MAX_LIVE_RAIDERS) - live.length,
    raiderCampPopulationCap(state, camp) - live.filter(unit => packs.has(unit.marauderPack ?? -1)).length));
  const needed = Math.min(size - units.length, capacity);
  const points = needed > 0 ? attackedBuilding && attacker ? defenderSpawnTiles(state, attackedBuilding, attacker, needed)
    : campSpawnTiles(state, camp, needed) : [];
  if (defense && units.length + points.length < minimum) {
    for (const [unit, before] of previous) {
      Object.assign(unit, before);
      refreshEarlyCombatUnit(state, unit);
      entityStore(state).setUnitSleeping(unit, !!before.inside);
    }
    return [];
  }
  units.push(...recruit(state, points.slice(0, needed), era, defense));
  return units;
}

/** Every physical camp structure gets its own bounded response, including a
 * lethal first hit. Repeated hits during the same episode cannot farm spawns. */
export function defendRaiderCamp(state: GameState, building: Building, attacker: Pick<Unit, 'faction'> & Point): number {
  if (!banditIntensity(state) || building.faction !== -2 || building.raiderCamp === undefined || attacker.faction < 0) return 0;
  const camp = state.raiderCamps?.find(camp => camp.id === building.raiderCamp);
  // Credit the realm even for the blow that just burned the camp.
  if (camp) camp.lastAttacker = attacker.faction;
  if (!camp || !raiderCampActive(state, camp)) return 0;
  provokeRaiderCamp(state, camp.id, attacker.faction);
  if ((camp.defenderReadyAt?.[building.id] ?? -Infinity) > state.time) return 0;
  (camp.defenderReadyAt ??= {})[building.id] = banditSpawnDeadline(state, RAIDER_DEFENDER_COOLDOWN);
  const count = raiderPartySize(2 + Math.floor(simRandom(state) * 4), state.time);
  const target: Building = { id: -1, kind: 'house', faction: attacker.faction, x: attacker.x, y: attacker.y, hp: 1, maxHp: 1, capacity: 0 };
  const party = takeCampParty(state, camp, count, raidEra(state, attacker.faction), true, building, attacker);
  if (!party.length) return 0;
  const pack = assignParty(state, target, party, { x: camp.gate.x + .5, y: camp.gate.y + .5 }, camp, true);
  pack.targetBuilding = undefined; pack.waypoint = { x: attacker.x, y: attacker.y };
  return party.length;
}

function nearestCamp(state: GameState, point: Point, returningMembers: readonly Unit[]): RaiderCamp | undefined {
  const belonging = new Map((state.marauderPacks ?? []).map(pack => [pack.id, pack.raiderCamp]));
  const returning = new Set(returningMembers.map(unit => unit.id));
  return (state.raiderCamps ?? []).filter(camp => raiderCampActive(state, camp)
    && state.units.filter(unit => unit.hp > 0 && !returning.has(unit.id) && belonging.get(unit.marauderPack ?? -1) === camp.id).length
      + returningMembers.length <= raiderCampPopulationCap(state, camp))
    .sort((a, b) => distance(point, a.gate) - distance(point, b.gate))
    .find(camp => hasStaticPath(state, point, { x: camp.gate.x + .5, y: camp.gate.y + .5 }, -2));
}
/** Nearest objective of a realm whose director is building up or raiding.
 * Skips routing entirely while every realm is resting. */
function openRaidTarget(state: GameState, from: Point, pack: number): Building | undefined {
  if (!directedFactions(state).some(faction => raidDirectorOpen(state, faction.id))) return;
  return selectRaidTarget(state, from, pack, undefined, undefined, building => raidDirectorOpen(state, building.faction));
}
function returnToCamp(state: GameState, pack: MarauderPack, members: Unit[]): void {
  const origin = members.find(unit => !unit.inside) ?? members[0]; if (!origin) return;
  const current = state.raiderCamps?.find(camp => camp.id === pack.raiderCamp && raiderCampActive(state, camp)
    && hasStaticPath(state, origin, { x: camp.gate.x + .5, y: camp.gate.y + .5 }, -2));
  const camp = current ?? nearestCamp(state, origin, members);
  if (camp) {
    pack.raiderCamp = camp.id; pack.home = raiderCampRefuge(camp);
    pack.returning = true; pack.waypoint = { ...pack.home }; delete pack.siegeNextReinforceAt;
  } else {
    const target = openRaidTarget(state, origin, pack.id);
    pack.returning = false; pack.raid = !!target; pack.campDefense = false; pack.motivation = 'assault';
    pack.targetBuilding = target?.id; if (target) { pack.targetFaction = target.faction; pack.waypoint = center(target); }
    else { pack.home = { x: origin.x, y: origin.y }; pack.nextWanderAt = state.time; }
    delete pack.raiderCamp;
  }
  for (const unit of members) if (!unit.inside && !(unit.order === 'flee' && unit.routed)) {
    clearOrders(unit); unit.order = pack.returning ? 'wander' : 'raid'; unit.routed = false;
  }
  pack.lastProgressAt = state.time;
}

/** Returning units physically enter a surviving camp house. Kept as a per-unit
 * movement hook so active raiders never stand indefinitely at the gate. */
export function updateRaiderReturn(state: GameState, unit: Unit, pack: MarauderPack,
  move: (point: Point) => void): boolean {
  if (!pack.returning) return false;
  const camp = state.raiderCamps?.find(camp => camp.id === pack.raiderCamp && raiderCampActive(state, camp));
  if (!camp) return false;
  const refuge = raiderCampRefuge(camp);
  // Commanders cross the core gate before entering a corner tower. They must
  // never disappear into an exposed tent while fleeing toward the refuge.
  if (unit.marauderLeader && distance(unit, refuge) > .7) { move(refuge); return true; }
  const shelterIds = unit.marauderLeader || !camp.houses.some(id => !!buildingWithId(state, id, buildingReady))
    ? camp.coreTowers ?? [] : camp.houses;
  const revision = entityStore(state).buildings.revision;
  let journey = shelterJourneys.get(unit);
  if (!journey || journey.camp !== camp.id || journey.revision !== revision || state.time >= journey.until
    || !buildingReady(journey.house) || journey.house.faction !== -2 || !shelterIds.includes(journey.house.id)) {
    // Same houses in building order, looked up by id instead of a world scan.
    const store = entityStore(state).buildings;
    const houses = [...new Set(shelterIds)].map(id => store.get(id)).filter((building): building is Building => !!building && buildingReady(building))
      .sort((a, b) => store.indexOf(a) - store.indexOf(b));
    const entrances = houses.flatMap(house => constructionEdges(state, house).map(point => ({ house, point })))
      .filter(({ point }) => canWalk(state, point.x, point.y, -2))
      .sort((a, b) => distance(unit, a.point) - distance(unit, b.point));
    const entrance = entrances.find(({ point }) => hasStaticPath(state, unit, point, -2));
    journey = entrance && { camp: camp.id, house: entrance.house, exit: entrance.point, revision, until: state.time + 5 };
    if (journey) shelterJourneys.set(unit, journey); else shelterJourneys.delete(unit);
  }
  const entrance = journey;
  if (!entrance) {
    pack.returning = false; pack.raid = true; pack.campDefense = false; pack.motivation = 'assault';
    pack.targetBuilding = undefined; pack.lastProgressAt = state.time; unit.marauderRetreating = false; return false;
  }
  const { house, exit } = entrance;
  // Test the rare garrison marker first and reuse the camp lists, instead of
  // rebuilding an id array for every unit in the world.
  let sleeping = 0;
  for (const other of state.units)
    if (other.raiderGarrison !== undefined && other.hp > 0 && other.inside
      && (camp.houses.includes(other.raiderGarrison) || !!camp.coreTowers?.includes(other.raiderGarrison))) sleeping++;
  if (sleeping >= Math.min(RAIDER_CAMP_RESERVES, raiderCampPopulationCap(state, camp))) {
    pack.returning = false; pack.raid = true; pack.campDefense = false; pack.motivation = 'assault';
    pack.targetBuilding = undefined; pack.lastProgressAt = state.time; unit.marauderRetreating = false; return false;
  }
  if (edgeDistance(unit, house) <= .85) {
    unit.x = house.x + .5; unit.y = house.y + .5; unit.inside = true; unit.raiderGarrison = house.id;
    unit.stolenGold = 0; clearOrders(unit); unit.order = 'hold'; entityStore(state).setUnitSleeping(unit, true); return true;
  }
  move(exit);
  return true;
}

/** One cheap lifecycle pass per second; expensive routing happens only when a
 * camp is lost. Raid launches belong to the raid director. */
export function updateRaiderActivity(state: GameState): void {
  if (state.time < (planningAt.get(state) ?? -Infinity)) return;
  planningAt.set(state, state.time + 1);
  for (const unit of state.units) if (unit.hp > 0 && unit.raiderGarrison !== undefined) {
    const home = buildingWithId(state, unit.raiderGarrison, building => buildingReady(building) && building.faction === -2);
    if (!home) releaseRaiderReserve(state, unit, true);
    else entityStore(state).setUnitSleeping(unit, true);
  }
  for (const pack of state.marauderPacks ?? []) {
    if (pack.seaInvasion !== undefined || pack.ruinsAmbush) continue;
    const members = membersOf(state, pack); if (!members.length) continue;
    const active = members.filter(unit => !unit.inside);
    if (!active.length) { pack.returning = true; delete pack.siegeNextReinforceAt; continue; }
    const position = active.find(unit => unit.marauderLeader) ?? active[0];
    if (!pack.progressPosition || distance(position, pack.progressPosition) > 1 || active.some(unit => state.time - unit.lastCombat < 5)) {
      pack.progressPosition = { x: position.x, y: position.y }; pack.lastProgressAt = state.time;
    }
    const lostCamp = pack.raiderCamp !== undefined && !state.raiderCamps?.some(camp => camp.id === pack.raiderCamp && raiderCampActive(state, camp));
    if (lostCamp && !pack.campDefense || pack.returning && pack.raiderCamp === undefined
      || pack.campDefense && !pack.returning && state.time >= (pack.defenseUntil ?? 0)
      // Reinforcement retries cannot exempt a blocked approach forever. Only
      // an actual muster may wait in place; it has its own 90-second deadline.
      || pack.phase !== 'muster' && state.time - (pack.lastProgressAt ?? state.time) > 30)
      returnToCamp(state, pack, members);
    // No idle patrols: a camp band goes indoors; an independent active band
    // immediately acquires an actual faction objective.
    if (!pack.raid && !pack.returning && !pack.campDefense && pack.raiderCamp !== undefined) returnToCamp(state, pack, members);
    if (!pack.raid && !pack.returning && !pack.campDefense && pack.raiderCamp === undefined) {
      // Orphaned bands only strike realms the director has not put to rest.
      const target = openRaidTarget(state, position, pack.id);
      if (target) {
        pack.raid = true; pack.microRaid = true; pack.motivation = 'assault';
        pack.targetBuilding = target.id; pack.targetFaction = target.faction; pack.waypoint = center(target);
        for (const unit of active) if (unit.order !== 'flee' && !unit.routed) { clearOrders(unit); unit.order = 'raid'; }
      } else if (state.raiderCamps?.some(camp => raiderCampActive(state, camp))) returnToCamp(state, pack, members);
    }
  }
  const living = new Set(state.units.filter(unit => unit.hp > 0).map(unit => unit.marauderPack));
  state.marauderPacks = (state.marauderPacks ?? []).filter(pack => living.has(pack.id));
}
