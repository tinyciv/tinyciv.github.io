import { entityStore } from './entity-store';
import { banditIntensity, banditPopulationCap, banditSpawnDeadline } from './bandit-intensity';
import { canRallyFromRout } from './battle-morale';
import { constructionEdges } from './builders';
import { canMove, canWalk, hasStaticPath, travelTimeMap } from './pathfinding';
import { pointInSight, updateFog } from './fog';
import { fogRaidProfile } from './fog-raids';
import { campSpawnTiles, MAX_LIVE_RAIDERS, RAIDER_COLOR, raiderCampActive, raiderCampPartySize, raiderCampPopulationCap, raiderCampRefuge } from './raider-camps';
import { ensureMarauderLeaders } from './marauder-leaders';
import { raiderEquipmentMultiplier } from './raider-pressure';
import { setSoldierRole } from './archery';
import { selectRaidTarget } from './raid-targeting';
import { buildingReady, buildingWidth, buildingHeight, distance, isSoldier, isWallKind, type Building, type GameState, type MarauderPack, type Point, type RaiderCamp, type Unit } from './types';

export const RAIDER_SKIRMISH_MIN_SECONDS = 18;
export const RAIDER_SKIRMISH_MAX_SECONDS = 24;
export const RAIDER_OPENING_TRAVEL_SECONDS = 18;
export const RAIDER_CAMP_RESERVES = 30;
export const RAIDER_DEFENDER_COOLDOWN = 30;
const planningAt = new WeakMap<GameState, number>();
const center = (building: Building): Point => ({ x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 });
const edgeDistance = (point: Point, building: Building): number => Math.hypot(Math.max(building.x - point.x, 0, point.x - building.x - buildingWidth(building)),
  Math.max(building.y - point.y, 0, point.y - building.y - buildingHeight(building)));
const membersOf = (state: GameState, pack: MarauderPack): Unit[] => state.units.filter(unit => unit.hp > 0 && unit.marauderPack === pack.id);
const fullFactions = (state: GameState) => state.factions.filter(faction => faction.id >= 0 && faction.villageId === undefined && !faction.defeated && faction.relation !== 'confederated');
const random = (state: GameState): number => {
  let n = state.rngState += 0x6D2B79F5;
  n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61);
  state.rngState >>>= 0; return ((n ^ n >>> 14) >>> 0) / 4294967296;
};
const clearOrders = (unit: Unit): void => {
  unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined;
  unit.repathAt = 0; unit.moving = false; unit.attackTime = 0;
};

function reserveExit(state: GameState, unit: Unit): Point | undefined {
  const building = state.buildings.find(building => building.id === unit.raiderGarrison);
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
function recruit(state: GameState, points: readonly Point[], defendingSoldiers: number, defense = false): Unit[] {
  const profile = fogRaidProfile(defendingSoldiers, state.time);
  let id = Math.max(0, ...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id));
  return points.map((point, index) => {
    const unit: Unit = { id: ++id, kind: 'warrior', faction: -2, ...point,
      hp: defense ? Math.max(55, profile.hp) : profile.hp, maxHp: defense ? Math.max(55, profile.hp) : profile.hp,
      attack: defense ? Math.max(8, profile.attack) : profile.attack, defense: profile.defense,
      morale: 100, speed: 2.35, range: 1.1, order: 'raid', cooldown: 0, lastCombat: -60, lastDamagedAt: -60,
      moving: false, facing: 0, attackTime: 0, bornAt: state.time, raiderEquipmentMultiplier: raiderEquipmentMultiplier(state.time) };
    // Retain two-thirds of the former archer assignments across small parties.
    if (defense && index % 3 === 1 && random(state) < 2 / 3) setSoldierRole(unit, 'archer');
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
function takeCampParty(state: GameState, camp: RaiderCamp, size: number, defendingSoldiers: number, defense = false,
  attackedBuilding?: Building, attacker?: Point): Unit[] {
  size = defense ? Math.max(2, raiderCampPartySize(state, camp, size)) : raiderCampPartySize(state, camp, size);
  const units: Unit[] = [], previous = new Map<Unit, Unit>();
  for (const reserve of campReserves(state, camp)) {
    if (units.length >= size) break;
    if (reserve.marauderLeader && (defense || units.some(unit => unit.marauderLeader))) continue;
    const before = { ...reserve };
    if (!releaseRaiderReserve(state, reserve)) continue;
    previous.set(reserve, before); units.push(reserve);
  }
  const packs = new Set((state.marauderPacks ?? []).filter(pack => pack.raiderCamp === camp.id).map(pack => pack.id));
  const live = state.units.filter(unit => unit.hp > 0 && unit.faction === -2);
  const capacity = Math.max(0, Math.min(banditPopulationCap(state, MAX_LIVE_RAIDERS) - live.length,
    raiderCampPopulationCap(state, camp) - live.filter(unit => packs.has(unit.marauderPack ?? -1)).length));
  const needed = Math.min(size - units.length, capacity);
  const points = needed > 0 ? attackedBuilding && attacker ? defenderSpawnTiles(state, attackedBuilding, attacker, needed)
    : campSpawnTiles(state, camp, needed) : [];
  if (defense && units.length + points.length < 2) {
    for (const [unit, before] of previous) { Object.assign(unit, before); entityStore(state).setUnitSleeping(unit, !!before.inside); }
    return [];
  }
  units.push(...recruit(state, points.slice(0, needed), defendingSoldiers, defense));
  return units;
}

/** Place one real, reachable opening band per full faction. These groups
 * begin marching at game start, rather than waiting for the large-wave clock. */
export function initializeRaiderSkirmishes(state: GameState): void {
  if (state.raiderSkirmishes) return;
  state.raiderSkirmishes = { nextByFaction: {}, wavesByFaction: {} };
  const fog = updateFog(state);
  for (const faction of fullFactions(state).sort((a, b) => a.id - b.id)) {
    const palace = state.buildings.find(building => building.kind === 'palace' && building.faction === faction.id && buildingReady(building));
    const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === faction.id && unit.hp > 0);
    if (!palace || !leader) continue;
    state.raiderSkirmishes.nextByFaction[faction.id] = banditSpawnDeadline(state, RAIDER_SKIRMISH_MIN_SECONDS + faction.id % 7);
    state.raiderSkirmishes.wavesByFaction[faction.id] = 0;
    if (!banditIntensity(state)) continue;
    const travel = travelTimeMap(state, leader, -2, 2.35, RAIDER_OPENING_TRAVEL_SECONDS);
    const candidates: { point: Point; cost: number; hidden: boolean }[] = [];
    const occupied = new Set(state.units.filter(unit => unit.hp > 0 && !unit.inside).map(unit => Math.floor(unit.y) * state.world.width + Math.floor(unit.x)));
    for (let cell = 0; cell < travel.length; cell++) {
      if (!Number.isFinite(travel[cell]) || travel[cell] < 5 || travel[cell] > RAIDER_OPENING_TRAVEL_SECONDS || occupied.has(cell)) continue;
      const point = { x: cell % state.world.width + .5, y: Math.floor(cell / state.world.width) + .5 };
      if (distance(point, leader) < 10 || edgeDistance(point, palace) < 9 || !canWalk(state, point.x, point.y, -2)) continue;
      if (state.units.some(unit => unit.hp > 0 && unit.faction >= 0 && !unit.inside && distance(unit, point) < 7)) continue;
      candidates.push({ point, cost: travel[cell], hidden: !pointInSight(fog, point.x, point.y) });
    }
    candidates.sort((a, b) => Number(b.hidden) - Number(a.hidden) || Math.abs(a.cost - 10) - Math.abs(b.cost - 10));
    const source = candidates[0], living = state.units.filter(unit => unit.hp > 0 && unit.faction === -2).length;
    const points = source ? candidates.filter(candidate => distance(candidate.point, source.point) <= 2).slice(0, Math.max(0, Math.min(Math.round(3 * banditIntensity(state)), banditPopulationCap(state, MAX_LIVE_RAIDERS) - living))).map(candidate => candidate.point) : [];
    if (source && points.length) assignParty(state, palace, recruit(state, points, 0), source.point);
  }
}

/** Every physical camp structure gets its own bounded response, including a
 * lethal first hit. Repeated hits during the same episode cannot farm spawns. */
export function defendRaiderCamp(state: GameState, building: Building, attacker: Pick<Unit, 'faction'> & Point): number {
  if (!banditIntensity(state) || building.faction !== -2 || building.raiderCamp === undefined || attacker.faction < 0) return 0;
  const camp = state.raiderCamps?.find(camp => camp.id === building.raiderCamp);
  if (!camp || !raiderCampActive(state, camp) || (camp.defenderReadyAt?.[building.id] ?? -Infinity) > state.time) return 0;
  (camp.defenderReadyAt ??= {})[building.id] = banditSpawnDeadline(state, RAIDER_DEFENDER_COOLDOWN);
  const count = 2 + Math.floor(random(state) * 4);
  const target: Building = { id: -1, kind: 'house', faction: attacker.faction, x: attacker.x, y: attacker.y, hp: 1, maxHp: 1, capacity: 0 };
  const party = takeCampParty(state, camp, count, state.units.filter(unit => unit.faction === attacker.faction && unit.hp > 0 && isSoldier(unit)).length, true, building, attacker);
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
function returnToCamp(state: GameState, pack: MarauderPack, members: Unit[]): void {
  const origin = members.find(unit => !unit.inside) ?? members[0]; if (!origin) return;
  const current = state.raiderCamps?.find(camp => camp.id === pack.raiderCamp && raiderCampActive(state, camp)
    && hasStaticPath(state, origin, { x: camp.gate.x + .5, y: camp.gate.y + .5 }, -2));
  const camp = current ?? nearestCamp(state, origin, members);
  if (camp) {
    pack.raiderCamp = camp.id; pack.home = raiderCampRefuge(camp);
    pack.returning = true; pack.waypoint = { ...pack.home }; delete pack.siegeNextReinforceAt;
  } else {
    const target = selectRaidTarget(state, origin, pack.id);
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
  const shelterIds = unit.marauderLeader || !camp.houses.some(id => state.buildings.some(b => b.id === id && buildingReady(b)))
    ? camp.coreTowers ?? [] : camp.houses;
  const houses = state.buildings.filter(building => shelterIds.includes(building.id) && buildingReady(building));
  const entrances = houses.flatMap(house => constructionEdges(state, house).map(point => ({ house, point })))
    .filter(({ point }) => canWalk(state, point.x, point.y, -2))
    .sort((a, b) => distance(unit, a.point) - distance(unit, b.point));
  const entrance = entrances.find(({ point }) => hasStaticPath(state, unit, point, -2));
  if (!entrance) {
    pack.returning = false; pack.raid = true; pack.campDefense = false; pack.motivation = 'assault';
    pack.targetBuilding = undefined; pack.lastProgressAt = state.time; unit.marauderRetreating = false; return false;
  }
  const { house, point: exit } = entrance;
  const sleeping = state.units.filter(other => other.hp > 0 && other.inside && other.raiderGarrison !== undefined && [...camp.houses, ...(camp.coreTowers ?? [])].includes(other.raiderGarrison)).length;
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

function launchSkirmish(state: GameState, faction: number, size: number): boolean {
  // Walls can be breached; water and ledges still separate unreachable realms.
  const planning = { ...state, buildings: state.buildings.filter(building => !(building.faction >= 0 && isWallKind(building.kind))) };
  const targets = state.buildings.filter(building => building.kind === 'palace' && building.faction === faction && buildingReady(building));
  if (!targets.length) return false;
  for (const camp of (state.raiderCamps ?? []).filter(camp => raiderCampActive(state, camp) && campReserves(state, camp).length)
    .sort((a, b) => Math.min(...targets.map(target => distance(a.gate, target))) - Math.min(...targets.map(target => distance(b.gate, target))))) {
    const origin = { x: camp.gate.x + .5, y: camp.gate.y + .5 };
    const target = targets.find(target => constructionEdges(state, target).some(point => hasStaticPath(planning, origin, point, -2)));
    if (!target) continue;
    const party = takeCampParty(state, camp, size, state.units.filter(unit => unit.hp > 0 && unit.faction === faction && isSoldier(unit)).length);
    if (party.length) { assignParty(state, target, party, origin, camp); return true; }
  }
  // Reassign an existing local idle band before manufacturing another party.
  for (const pack of (state.marauderPacks ?? []).filter(pack => !pack.campDefense && (!pack.raid || pack.returning && pack.raiderCamp === undefined))
    .sort((a, b) => Math.min(...targets.map(target => distance(a.home, target))) - Math.min(...targets.map(target => distance(b.home, target))))) {
    const members = membersOf(state, pack).filter(unit => !unit.inside && unit.order !== 'flee' && canRallyFromRout(state, unit)); if (!members.length) continue;
    const target = targets.slice().sort((a, b) => distance(members[0], a) - distance(members[0], b))
      .find(target => constructionEdges(state, target).some(point => hasStaticPath(planning, members[0], point, -2)));
    if (!target) continue;
    const chosen = members.sort((a, b) => Number(!!b.marauderLeader) - Number(!!a.marauderLeader)).slice(0, size);
    assignParty(state, target, chosen, pack.home); return true;
  }
  const choices = (state.raiderCamps ?? []).filter(camp => raiderCampActive(state, camp))
    .flatMap(camp => targets.map(target => ({ camp, target, d: distance(camp.gate, target) }))).sort((a, b) => a.d - b.d);
  for (const { camp, target } of choices) {
    const origin = { x: camp.gate.x + .5, y: camp.gate.y + .5 };
    if (!constructionEdges(state, target).some(point => hasStaticPath(planning, origin, point, -2))) continue;
    const party = takeCampParty(state, camp, size, state.units.filter(unit => unit.hp > 0 && unit.faction === faction && isSoldier(unit)).length);
    if (!party.length) continue;
    assignParty(state, target, party, origin, camp); return true;
  }
  return false;
}

/** One cheap lifecycle pass per second; expensive routing happens only when a
 * camp is lost or an actual small-raid deadline is reached. */
export function updateRaiderActivity(state: GameState): void {
  if (state.time < (planningAt.get(state) ?? -Infinity)) return;
  planningAt.set(state, state.time + 1);
  for (const unit of state.units) if (unit.hp > 0 && unit.raiderGarrison !== undefined) {
    const home = state.buildings.find(building => building.id === unit.raiderGarrison && buildingReady(building) && building.faction === -2);
    if (!home) releaseRaiderReserve(state, unit, true);
    else entityStore(state).setUnitSleeping(unit, true);
  }
  for (const pack of state.marauderPacks ?? []) {
    const members = membersOf(state, pack); if (!members.length) continue;
    const active = members.filter(unit => !unit.inside);
    if (!active.length) { pack.returning = true; delete pack.siegeNextReinforceAt; continue; }
    const position = active.find(unit => unit.marauderLeader) ?? active[0];
    if (!pack.progressPosition || distance(position, pack.progressPosition) > 1 || active.some(unit => state.time - unit.lastCombat < 5)) {
      pack.progressPosition = { x: position.x, y: position.y }; pack.lastProgressAt = state.time;
    }
    const lostCamp = pack.raiderCamp !== undefined && !state.raiderCamps?.some(camp => camp.id === pack.raiderCamp && raiderCampActive(state, camp));
    if (lostCamp && !pack.campDefense || pack.returning && pack.raiderCamp === undefined
      || pack.campDefense && state.time >= (pack.defenseUntil ?? 0)
      // Reinforcement retries cannot exempt a blocked approach forever. Only
      // an actual muster may wait in place; it has its own 90-second deadline.
      || pack.phase !== 'muster' && state.time - (pack.lastProgressAt ?? state.time) > 30)
      returnToCamp(state, pack, members);
    // Independent wanderers receive a real attack objective after a brief patrol.
    if (!pack.raid && !pack.returning && pack.raiderCamp === undefined && state.time - (pack.spawnedAt ?? 0) > 20) {
      const target = selectRaidTarget(state, position, pack.id);
      if (target) { pack.raid = true; pack.microRaid = true; pack.targetBuilding = target.id; pack.targetFaction = target.faction; pack.waypoint = center(target); }
    }
  }
  const clock = state.raiderSkirmishes; if (!banditIntensity(state) || !clock || state.gameOver || state.paused || state.victory && !state.victoryContinued) return;
  for (const faction of fullFactions(state).sort((a, b) => (clock.nextByFaction[a.id] ?? 0) - (clock.nextByFaction[b.id] ?? 0) || a.id - b.id)) {
    if (state.time < (clock.nextByFaction[faction.id] ?? Infinity)) continue;
    const wave = clock.wavesByFaction[faction.id] ?? 0;
    const launched = launchSkirmish(state, faction.id, 1 + wave % 5);
    if (launched) clock.wavesByFaction[faction.id] = wave + 1;
    clock.nextByFaction[faction.id] = banditSpawnDeadline(state, launched ? RAIDER_SKIRMISH_MIN_SECONDS + random(state) * (RAIDER_SKIRMISH_MAX_SECONDS - RAIDER_SKIRMISH_MIN_SECONDS) : 5);
  }
  const living = new Set(state.units.filter(unit => unit.hp > 0).map(unit => unit.marauderPack));
  state.marauderPacks = (state.marauderPacks ?? []).filter(pack => living.has(pack.id));
}
