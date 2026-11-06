import { territory, UNCLAIMED } from './borders';
import { cityResidents, invalidateCitySummarySnapshot } from './cities';
import { cityOwnership } from './city-ownership';
import { entityStore } from './entity-store';
import { nearbyUnits } from './spatial';
import { spendGold } from './gold-ledger';
import { canWalk, createReachabilityQuery } from './pathfinding';
import { invalidateSettlementDecisions } from './settlement-decisions';
import { buildingHeight, buildingReady, buildingWidth, distance, type Building, type GameState, type Point, type Unit } from './types';

const SCOUT_SPEED = 3.6 * 1.1 * 1.2;

export const OBSERVATION_POST_COST = 20;
export const OBSERVATION_POST_UPKEEP = 3;
export const OBSERVATION_POST_UPKEEP_SECONDS = 30;
export const OBSERVATION_POST_SIGHT = 21;
export const OBSERVATION_POST_SMOKE_SECONDS = 60;
export const OBSERVATION_POST_SMOKE_DURATION = 5;
export const OBSERVATION_POST_FLEE_SPEED = SCOUT_SPEED * 1.3;

export function hasObservationLodge(state: GameState, faction: number): boolean {
  return entityStore(state).buildings.query('scoutLodge').some(lodge => lodge.faction === faction && buildingReady(lodge));
}
function recruitingCity(state: GameState, faction: number, point: Point): Building | undefined {
  return cityResidents(state).filter(city => city.palace.faction === faction && city.population >= 1)
    .sort((a, b) => distance(a.palace, point) - distance(b.palace, point) || a.palace.id - b.palace.id)[0]?.palace;
}
export function validateObservationPost(state: GameState, faction: number, point: Point): { ok: boolean; message: string } {
  let message = '';
  if (!hasObservationLodge(state, faction)) message = 'Complete a Scouts’ Lodge first.';
  else if (!recruitingCity(state, faction, point)) message = 'Need 1 resident to staff the observation post.';
  else if ((territory(state).owners[Math.floor(point.y) * state.world.width + Math.floor(point.x)] ?? UNCLAIMED) !== UNCLAIMED)
    message = 'Observation posts must be outside all borders.';
  else if (!canWalk(state, point.x, point.y, faction)) message = 'Place the observation post on clear, walkable ground.';
  else if (state.units.some(unit => unit.hp > 0 && unit.observationPost && !unit.observationPost.retreating
    && Math.floor(unit.x) === Math.floor(point.x) && Math.floor(unit.y) === Math.floor(point.y))) message = 'An observation post already occupies this tile.';
  if (!message && !nearestReturn(state, { ...point, faction }).city) message = 'Observation posts need a walking route to a friendly settlement.';
  return { ok: !message, message };
}
function residentsChanged(state: GameState): void {
  invalidateCitySummarySnapshot(state); invalidateSettlementDecisions(state);
}
/** Deployment transfers one actual resident, rather than creating a free scout. */
export function placeObservationPost(state: GameState, factionId: number, point: Point): { ok: boolean; message: string } {
  const validation = validateObservationPost(state, factionId, point);
  if (!validation.ok) return validation;
  const faction = state.factions.find(candidate => candidate.id === factionId), city = recruitingCity(state, factionId, point);
  if (!city || !faction || faction.gold < OBSERVATION_POST_COST) return { ok: false, message: 'Need 20 gold and 1 resident.' };
  const ownership = cityOwnership(state);
  const house = state.buildings.find(building => building.kind === 'house' && building.faction === factionId && buildingReady(building)
    && (building.residents ?? 0) > 0 && ownership.building(building)?.id === city.id);
  if (house) house.residents!--;
  else city.unhousedResidents = Math.max(0, (city.unhousedResidents ?? 0) - 1);
  faction.population--;
  spendGold(state, faction, OBSERVATION_POST_COST, 'construction');
  const x = Math.floor(point.x) + .5, y = Math.floor(point.y) + .5, store = entityStore(state);
  store.units.add({ id: Math.max(0, ...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id)) + 1, kind: 'scout', faction: factionId, x, y,
    hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 4, speed: SCOUT_SPEED, range: 0,
    order: 'hold', cooldown: 0, lastCombat: -60, lastDamagedAt: -60, facing: Math.PI / 2, moving: false, attackTime: 0,
    observationPost: { x, y, city: city.id, discoveredBy: [], nextUpkeepAt: state.time + OBSERVATION_POST_UPKEEP_SECONDS,
      nextSmokeAt: state.time + OBSERVATION_POST_SMOKE_SECONDS } });
  residentsChanged(state);
  return { ok: true, message: 'Observation post established.' };
}

export function beginObservationPostRetreat(unit: Unit): void {
  const post = unit.observationPost;
  if (!post || post.retreating || unit.hp <= 0 || !post.discoveredBy.length) return;
  post.retreating = true; unit.order = 'flee'; unit.speed = OBSERVATION_POST_FLEE_SPEED;
  unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
}
interface ReturnPlan { nextAt: number; city?: Building; goal?: Point }
const returns = new WeakMap<Unit, ReturnPlan>();
function nearestReturn(state: GameState, scout: Pick<Unit, 'x' | 'y' | 'faction'>): ReturnPlan {
  const reachable = createReachabilityQuery(state, scout, scout.faction);
  const cities = entityStore(state).buildings.query('palace').filter(city => city.faction === scout.faction && buildingReady(city))
    .sort((a, b) => distance(a, scout) - distance(b, scout));
  for (const city of cities) {
    const w = buildingWidth(city), h = buildingHeight(city), exits: Point[] = [];
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      if (x >= 0 && x < w && y >= 0 && y < h) continue;
      const point = { x: city.x + x + .5, y: city.y + y + .5 };
      if (canWalk(state, point.x, point.y, scout.faction) && reachable(point)) exits.push(point);
    }
    exits.sort((a, b) => distance(scout, a) - distance(scout, b));
    if (exits.length) return { nextAt: state.time + 2, city, goal: exits[0] };
  }
  return { nextAt: state.time + 2 };
}
/** A saved sixty-second deadline emits only an approximate hint. No post ID or
 * exact coordinates travel to an opponent in this presentation event. */
function emitSmoke(state: GameState, scout: Unit): void {
  const post = scout.observationPost!;
  const sequence = Math.floor(state.time / OBSERVATION_POST_SMOKE_SECONDS);
  const angle = ((Math.imul(scout.id + sequence, 2654435761) >>> 0) / 4294967296) * Math.PI * 2;
  const radius = 2.5 + ((scout.id * 7 + sequence * 3) % 25) / 10;
  const x = Math.max(.5, Math.min(state.world.width - .5, post.x + Math.cos(angle) * radius));
  const y = Math.max(.5, Math.min(state.world.height - .5, post.y + Math.sin(angle) * radius));
  state.observationSmoke = (state.observationSmoke ?? []).filter(smoke => state.time - smoke.startedAt < OBSERVATION_POST_SMOKE_DURATION);
  state.observationSmoke.push({ x, y, faction: scout.faction, startedAt: state.time });
  post.nextSmokeAt = state.time + OBSERVATION_POST_SMOKE_SECONDS;
}
export function updateObservationPost(state: GameState, scout: Unit, dt: number,
  move: (state: GameState, unit: Unit, point: Point, dt: number) => void, hostile: (a: number, b: number) => boolean): boolean {
  const post = scout.observationPost;
  if (!post || scout.hp <= 0) return false;
  scout.moving = false; scout.target = undefined; scout.attackTime = 0;
  if (!post.retreating) {
    scout.x = post.x; scout.y = post.y; scout.order = 'hold'; scout.destination = undefined; scout.path = undefined;
    for (const leader of nearbyUnits(state, scout, 1.5)) if ((leader.kind === 'leader' || leader.marauderLeader) && leader.hp > 0 && !leader.inside
      && hostile(scout.faction, leader.faction) && Math.floor(leader.x) === Math.floor(post.x) && Math.floor(leader.y) === Math.floor(post.y)
      && !post.discoveredBy.includes(leader.faction)) post.discoveredBy.push(leader.faction);
    if (state.time >= post.nextUpkeepAt) {
      const faction = state.factions.find(candidate => candidate.id === scout.faction);
      const periods = Math.floor((state.time - post.nextUpkeepAt) / OBSERVATION_POST_UPKEEP_SECONDS) + 1;
      if (faction) spendGold(state, faction, periods * OBSERVATION_POST_UPKEEP, 'defenses');
      post.nextUpkeepAt += periods * OBSERVATION_POST_UPKEEP_SECONDS;
    }
    if (state.time >= post.nextSmokeAt) emitSmoke(state, scout);
    return true;
  }
  scout.order = 'flee'; scout.speed = OBSERVATION_POST_FLEE_SPEED;
  let plan = returns.get(scout);
  if (!plan || state.time >= plan.nextAt || plan.city && (!buildingReady(plan.city) || plan.city.faction !== scout.faction)) {
    plan = nearestReturn(state, scout); returns.set(scout, plan);
  }
  if (!plan.goal || !plan.city) return true; // Retry boundedly after terrain/city changes; never search every frame.
  if (distance(scout, plan.goal) > .45) { move(state, scout, plan.goal, dt); return true; }
  const faction = state.factions.find(candidate => candidate.id === scout.faction);
  if (faction) {
    const ownership = cityOwnership(state), city = plan.city;
    const house = state.buildings.find(building => building.kind === 'house' && building.faction === scout.faction && buildingReady(building)
      && (building.residents ?? 0) < building.capacity && ownership.building(building)?.id === city.id);
    if (house) house.residents = (house.residents ?? 0) + 1;
    else city.unhousedResidents = (city.unhousedResidents ?? 0) + 1;
    faction.population++; delete city.depopulated;
    residentsChanged(state);
  }
  scout.kind = 'worker'; scout.home = plan.city.id; scout.inside = true;
  delete scout.observationPost; scout.civilianCasualtyRecorded = true;
  // Returning civilians become residents, not an extra persistent job slot.
  entityStore(state).units.retain(unit => unit.id !== scout.id);
  return true;
}
