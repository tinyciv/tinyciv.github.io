import { simulationReadsActive } from './simulation-reads';
import { decisionDue, type DecisionClock } from './decision-schedule';
import { spendGold } from './gold-ledger';
import { playerFaction } from './player-context';
import { isForbidden } from './forbidden-zones';
import { buildingWorkForbidden } from './forbidden-work';
import { entityStore } from './entity-store';
import { constructionEdges } from './builders';
import { insideOwnBorders, territory, type Territory } from './borders';
import { buildingActivityAvailable, BUILDING_ACTIVITY_RANGE } from './building-activity';
import { canWalk, findPath } from './pathfinding';
import { cellOccupant, indexedUnit } from './spatial';
import { sightDistance } from './sight';
import { palaceEnclosures, type PalaceEnclosure, type PalaceEnclosures } from './enclosures';
import { releaseAttackSpot } from './engagement';
import { buildingReady, distance, type Building, type Faction, type GameState, type Point, type Unit } from './types';

export const GUARD_POST_CAPACITY = 3;
export const GUARD_POST_CAPACITIES = [3, 5, 8] as const;
export const GUARD_POST_UPGRADE_COSTS = [100, 125] as const;
export const GUARD_POST_UPKEEPS = [15, 20, 30] as const;
export const GUARD_POST_UPKEEP = GUARD_POST_UPKEEPS[0];
export const GUARD_POST_UPKEEP_INTERVAL = 30;
export const GUARD_POST_ALERT_SECONDS = 10;
export const GUARD_CIVILIAN_PROTECTION_RADIUS = 10;
export const GUARD_CIVILIAN_DANGER_RADIUS = 4;
export const GUARD_PURSUIT_RADIUS = 20;
export const MILITIA_HP = 85;
export const MILITIA_ATTACK = 14;
export const MILITIA_DEFENSE = 3;

interface GuardPostOrders { hostile: (a: number, b: number) => boolean }
interface MilitiaOrders {
  move: (state: GameState, unit: Unit, goal: Point, dt: number) => void;
  engage: (unit: Unit, target: Unit, dt: number) => void;
  canEngage?: (unit: Unit, target: Unit) => boolean;
}
interface GuardEnclosure { cells: ReadonlySet<number>; boundary: ReadonlySet<number> }
interface PostDefense { post: Building; city: Building; faction: number; upkeep: number; threats: Unit[]; civilians: Unit[]; rescueActive: boolean; enclosure?: GuardEnclosure }
interface DefenseFrame {
  posts: Map<number, PostDefense>;
  cities: Map<number, Building[]>;
  borders: Territory;
  hostile: GuardPostOrders['hostile'];
}
interface MilitiaPlan extends DecisionClock { target?: Unit }
const militiaPlans = new WeakMap<Unit, MilitiaPlan>();
const returnClocks = new WeakMap<Unit, DecisionClock>();
const frames = new WeakMap<GameState, DefenseFrame>();
const guardEnclosures = new WeakMap<PalaceEnclosure, GuardEnclosure>();
function cityEnclosure(areas: PalaceEnclosures, city: Building, post: Building): GuardEnclosure | undefined {
  const region = areas.regions.find(region => region.faction === city.faction && region.palaces.includes(city.id));
  if (!region) return;
  let enclosure = guardEnclosures.get(region);
  if (!enclosure) {
    const cells = new Set(region.cells), boundary = new Set<number>();
    // A one-cell fence prevents paths through any gate or diagonal exit,
    // without copying the entire outside world into every guard's A* search.
    for (const cell of cells) {
      const x = cell % areas.width, y = Math.floor(cell / areas.width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * areas.width + nx;
        if (nx >= 0 && ny >= 0 && nx < areas.width && ny < areas.height && !cells.has(next)) boundary.add(next);
      }
    }
    enclosure = { cells, boundary }; guardEnclosures.set(region, enclosure);
  }
  return enclosure.cells.has(post.y * areas.width + post.x) ? enclosure : undefined;
}
function insideEnclosure(state: GameState, enclosure: GuardEnclosure | undefined, point: Point): boolean {
  const x = Math.floor(point.x), y = Math.floor(point.y);
  return x >= 0 && y >= 0 && x < state.world.width && y < state.world.height
    && !!enclosure?.cells.has(y * state.world.width + x);
}
const human = (unit: Unit): boolean => ['leader', 'warrior', 'spearman', 'horseman', 'archer', 'militia', 'worker', 'merchant'].includes(unit.kind);
const civilian = (unit: Unit): boolean => unit.kind === 'worker' || unit.kind === 'merchant';
const center = (building: Building): Point => ({ x: building.x + .5, y: building.y + .5 });
export const guardPostLevel = (post: Building): 0 | 1 | 2 => Math.max(0, Math.min(2, Math.floor(post.guardPost?.level ?? 0))) as 0 | 1 | 2;
export const guardPostCapacity = (post: Building): number => GUARD_POST_CAPACITIES[guardPostLevel(post)];
export const guardPostUpkeep = (post: Building): number => GUARD_POST_UPKEEPS[guardPostLevel(post)];

export function guardPostUpgradeStatus(state: GameState, post: Building): { capacity: number; nextCapacity: number | null; cost: number | null; available: boolean; reason: string } {
  const level = guardPostLevel(post), capacity = guardPostCapacity(post);
  const nextCapacity = level < 2 ? GUARD_POST_CAPACITIES[level + 1] : null;
  const cost = level === 0 ? GUARD_POST_UPGRADE_COSTS[0] : level === 1 ? GUARD_POST_UPGRADE_COSTS[1] : null;
  const faction = state.factions.find(candidate => candidate.id === post.faction);
  let reason = '';
  if (state.gameOver || faction?.defeated) reason = 'Your realm can no longer upgrade guard posts.';
  else if (post.kind !== 'guardPost' || post.faction !== playerFaction(state) || !faction || !state.buildings.includes(post)) reason = 'Choose your own guard post.';
  else if (!buildingReady(post)) reason = 'Complete the guard post first.';
  else if (!buildingActivityAvailable(state, post)) reason = `Move your Leader within ${BUILDING_ACTIVITY_RANGE} tiles of the guard post.`;
  else if (nextCapacity === null) reason = 'Fully upgraded.';
  else if (faction.gold < cost!) reason = `Need ${cost} gold.`;
  return { capacity, nextCapacity, cost, available: !reason, reason };
}
export function upgradeGuardPost(state: GameState, post: Building): { ok: boolean; message: string } {
  const status = guardPostUpgradeStatus(state, post);
  if (!status.available) return { ok: false, message: status.reason };
  const faction = state.factions.find(candidate => candidate.id === post.faction)!;
  spendGold(state, faction, status.cost!, 'upgrades');
  post.guardPost ??= { nextUpkeepAt: state.time + GUARD_POST_UPKEEP_INTERVAL, funded: true };
  post.guardPost.level = (guardPostLevel(post) + 1) as 1 | 2;
  post.guardPost.needsRecruits = true;
  return { ok: true, message: `Guard post expanded to ${status.nextCapacity} guards.` };
}

/** Each post controls its own garrison; ordinary pursuit remains the default. */
export function setGuardPostWallsOnly(state: GameState, post: Building, enabled: boolean): { ok: boolean; message: string } {
  if (post.kind !== 'guardPost' || post.faction !== playerFaction(state) || !state.buildings.includes(post))
    return { ok: false, message: 'Choose your own guard post.' };
  if (!buildingActivityAvailable(state, post) || state.factions.find(faction => faction.id === post.faction)?.defeated)
    return { ok: false, message: 'Move your Leader within 3 tiles of a completed guard post.' };
  post.guardPost ??= { nextUpkeepAt: state.time + GUARD_POST_UPKEEP_INTERVAL, funded: true, needsRecruits: true };
  post.guardPost.wallsOnly = enabled;
  const defense = frames.get(state)?.posts.get(post.id);
  if (defense) defense.enclosure = enabled ? cityEnclosure(palaceEnclosures(state, true), defense.city, post) : undefined;
  for (const unit of state.units) if (unit.guardPost === post.id && unit.faction === post.faction && unit.hp > 0) {
    clearJourney(unit); releaseAttackSpot(state, unit);
  }
  return { ok: true, message: enabled ? 'Guards will stay inside city walls.' : 'Guards may pursue enemies beyond city walls.' };
}

/** Outside guards may return through a gate. Once inside, both path search
 * and physical movement obey the same perimeter, including crowd sidesteps. */
export function militiaMovementLimits(state: GameState, unit: Unit): ReadonlySet<number> | undefined {
  if (unit.kind !== 'militia') return;
  const defense = frames.get(state)?.posts.get(unit.guardPost ?? -1);
  if (defense?.post.guardPost?.wallsOnly && insideEnclosure(state, defense.enclosure, unit)) return defense.enclosure!.boundary;
}

/** Match the nearest-palace ownership rule used by city yields and governors. */
function nearestCity(cities: readonly Building[], point: Point): Building | undefined {
  let nearest: Building | undefined, best = Infinity;
  for (const palace of cities) {
    if (!buildingReady(palace)) continue;
    const d = (point.x - palace.x - 1) ** 2 + (point.y - palace.y - 1) ** 2;
    if (d < best || d === best && palace.id < nearest!.id) { nearest = palace; best = d; }
  }
  return nearest;
}

/** Guards are drawn from the city's existing residents, not free extra people. */
function cityPopulations(state: GameState, cities: Map<number, Building[]>): Map<number, number> {
  const populations = new Map<number, number>(), remaining = new Map(state.factions.map(faction => [faction.id, Math.max(0, faction.population)]));
  const add = (city: Building | undefined, requested: number): void => {
    if (!city) return;
    const count = Math.min(remaining.get(city.faction) ?? 0, Math.max(0, requested));
    remaining.set(city.faction, (remaining.get(city.faction) ?? 0) - count);
    populations.set(city.id, (populations.get(city.id) ?? 0) + count);
  };
  for (const house of state.buildings) if (house.kind === 'house' && buildingReady(house))
    add(nearestCity(cities.get(house.faction) ?? [], center(house)), Math.min(house.capacity, house.residents ?? 0));
  for (const list of cities.values()) for (const palace of list) add(palace, palace.unhousedResidents ?? 0);
  for (const [faction, list] of cities) {
    const first = [...list].sort((a, b) => a.id - b.id)[0];
    add(first, remaining.get(faction) ?? 0);
  }
  return populations;
}
function clearJourney(unit: Unit): void {
  unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined;
  unit.repathAt = 0; unit.moving = false;
}
function shelter(unit: Unit, post: Building): void {
  clearJourney(unit); unit.inside = true; unit.x = post.x + .5; unit.y = post.y + .5;
  unit.order = 'follow'; unit.routed = false; unit.routOrder = undefined;
}
function retire(unit: Unit): void { unit.guardRetired = true; unit.hp = 0; unit.inside = true; clearJourney(unit); }
function makeMilitia(state: GameState, post: Building, city: Building, id: number): Unit {
  const unit: Unit = {
    id, kind: 'militia', faction: post.faction, guardPost: post.id, guardCity: city.id, home: post.id,
    ...center(post), hp: MILITIA_HP, maxHp: MILITIA_HP, morale: 100,
    attack: MILITIA_ATTACK, defense: MILITIA_DEFENSE, speed: 3, range: 1.1,
    order: 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
    inside: true, bornAt: state.time, kills: post.guardPost?.kills ?? 0,
  };
  entityStore(state).units.add(unit);
  return unit;
}

/** Return true when the post recorded the kill instead of individual veterancy. */
export function recordGuardKill(state: GameState, unit: Unit): boolean {
  if (unit.kind !== 'militia') return false;
  const post = state.buildings.find(building => building.id === unit.guardPost && building.kind === 'guardPost' && buildingReady(building) && building.faction === unit.faction);
  if (!post?.guardPost) return false;
  post.guardPost.kills = Math.max(0, post.guardPost.kills ?? 0) + 1;
  for (const guard of state.units) if (guard.kind === 'militia' && guard.guardPost === post.id && guard.faction === post.faction && guard.hp > 0)
    guard.kills = post.guardPost.kills;
  return true;
}

/** Combat calls this before removing a corpse; repeated calls are harmless.
 * Administrative retirement returns a guard to civilian life and is excluded. */
export function recordGuardCasualty(state: GameState, unit: Unit): boolean {
  if (unit.kind !== 'militia' || unit.hp > 0 || unit.guardRetired || unit.guardCasualtyRecorded) return false;
  unit.guardCasualtyRecorded = true;
  const faction = state.factions.find(candidate => candidate.id === unit.faction);
  if (!faction || faction.population <= 0) return false;
  faction.population = Math.max(0, faction.population - 1);
  const palaces = state.buildings.filter(building => building.kind === 'palace' && building.faction === unit.faction && buildingReady(building));
  const city = palaces.find(palace => palace.id === unit.guardCity) ?? nearestCity(palaces, unit);
  if (city) {
    const house = state.buildings.filter(building => building.kind === 'house' && building.faction === unit.faction && buildingReady(building)
      && (building.residents ?? 0) > 0 && nearestCity(palaces, center(building))?.id === city.id)
      .sort((a, b) => distance(a, unit) - distance(b, unit) || a.id - b.id)[0];
    if (house) house.residents = Math.max(0, (house.residents ?? 0) - 1);
    else if ((city.unhousedResidents ?? 0) > 0) city.unhousedResidents!--;
  }
  return true;
}

/** The first thirty seconds are included with construction. A missed payment
 * suspends service; resuming buys a new interval instead of accumulating debt. */
function collectUpkeep(state: GameState, post: Building, faction: Faction): boolean {
  const guard = post.guardPost!, cost = guardPostUpkeep(post);
  let replenish = false;
  while (state.time + 1e-7 >= guard.nextUpkeepAt) {
    if (faction.gold + 1e-7 < cost) { guard.funded = false; break; }
    spendGold(state, faction, Math.min(cost, Math.max(0, faction.gold)), 'defenses');
    guard.nextUpkeepAt = (guard.funded ? guard.nextUpkeepAt : state.time) + GUARD_POST_UPKEEP_INTERVAL;
    guard.funded = true; replenish = true;
  }
  return replenish;
}
function civilianThreat(state: GameState, defense: PostDefense, target: Unit): boolean {
  return defense.civilians.some(person => person.hp > 0 && !person.inside
    && distance(person, center(defense.post)) <= GUARD_CIVILIAN_PROTECTION_RADIUS
    && distance(person, target) <= GUARD_CIVILIAN_DANGER_RADIUS
    && sightDistance(state.world, person, target.x, target.y, GUARD_CIVILIAN_DANGER_RADIUS) <= GUARD_CIVILIAN_DANGER_RADIUS);
}

/** Shared city threat lists and local civilian buckets keep response work local.
 * Sheltered guards are real residents with persistent post-owned experience. */
export function updateGuardPosts(state: GameState, orders: GuardPostOrders): Set<number> {
  const changed = new Set<number>(), previous = frames.get(state);
  for (const unit of state.units) if (unit.kind === 'militia' && unit.hp <= 0 && recordGuardCasualty(state, unit)) changed.add(unit.faction);
  if (!state.buildings.some(building => building.kind === 'guardPost')) {
    for (const defense of previous?.posts.values() ?? []) changed.add(defense.faction);
    for (const unit of state.units) if (unit.kind === 'militia' && unit.hp > 0) { retire(unit); changed.add(unit.faction); }
    frames.delete(state); return changed;
  }
  const factions = new Map(state.factions.filter(faction => !faction.defeated && faction.id >= 0).map(faction => [faction.id, faction]));
  const cities = new Map<number, Building[]>(), posts = new Map<number, PostDefense>();
  const threats = new Map<number, Unit[]>(), rosters = new Map<number, Unit[]>();
  let nextId = 1;
  for (const building of state.buildings) {
    nextId = Math.max(nextId, building.id + 1);
    if (building.kind === 'palace' && buildingReady(building) && factions.has(building.faction)) {
      const group = cities.get(building.faction) ?? [];
      group.push(building); cities.set(building.faction, group);
    }
  }
  const civilians = state.units.filter(unit => unit.hp > 0 && !unit.inside && civilian(unit));
  const borders = territory(state);
  const areas = state.buildings.some(building => building.kind === 'guardPost' && buildingReady(building) && building.guardPost?.wallsOnly)
    ? palaceEnclosures(state, true) : undefined;
  for (const post of state.buildings) {
    if (post.kind !== 'guardPost' || post.villageId !== undefined) continue;
    const faction = factions.get(post.faction);
    const city = nearestCity(cities.get(post.faction) ?? [], center(post));
    if (!faction || !buildingReady(post) || !city || !insideOwnBorders(state, post.faction, post.x, post.y, borders)) {
      if (post.guardPost?.funded) changed.add(post.faction);
      // Experience and the purchased tier survive lost territory, lost funding,
      // and capture. Only destroying the building erases the post's history.
      if (post.hp <= 0) post.guardPost = undefined;
      else if (post.guardPost) { post.guardPost.funded = false; post.guardPost.needsRecruits = true; }
      continue;
    }
    const cityThreats = threats.get(city.id) ?? [];
    threats.set(city.id, cityThreats);
    posts.set(post.id, { post, city, faction: post.faction, upkeep: guardPostUpkeep(post), threats: cityThreats, rescueActive: false,
      enclosure: areas && post.guardPost?.wallsOnly ? cityEnclosure(areas, city, post) : undefined, civilians: civilians.filter(unit => unit.faction === post.faction
      && distance(unit, center(post)) <= GUARD_CIVILIAN_PROTECTION_RADIUS && nearestCity(cities.get(unit.faction) ?? [], unit)?.id === city.id) });
  }
  for (const [id, defense] of previous?.posts ?? []) {
    const current = posts.get(id);
    if (!current || current.faction !== defense.faction) changed.add(defense.faction);
    if (current && (current.faction !== defense.faction || current.upkeep !== defense.upkeep)) changed.add(current.faction);
  }
  const enemyBuckets = new Map<string, Unit[]>(), bucketSize = 8;
  const enclosedCities = new Map<number, PostDefense>();
  for (const defense of posts.values()) if (defense.enclosure) enclosedCities.set(defense.city.id, defense);
  for (const unit of state.units) {
    nextId = Math.max(nextId, unit.id + 1);
    if (unit.kind === 'militia') {
      const defense = posts.get(unit.guardPost ?? -1);
      if (!defense || defense.post.faction !== unit.faction) { if (unit.hp > 0) retire(unit); changed.add(unit.faction); continue; }
      if (unit.hp > 0) {
        unit.guardCity = defense.city.id;
        const roster = rosters.get(defense.post.id) ?? [];
        roster.push(unit); rosters.set(defense.post.id, roster);
      }
    }
    if (unit.hp <= 0 || unit.inside || !human(unit) || unit.x < 0 || unit.y < 0
      || unit.x >= borders.width || unit.y >= borders.height) continue;
    const key = `${Math.floor(unit.x / bucketSize)},${Math.floor(unit.y / bucketSize)}`;
    const bucket = enemyBuckets.get(key) ?? [];
    bucket.push(unit); enemyBuckets.set(key, bucket);
    const owner = borders.owners[Math.floor(unit.y) * borders.width + Math.floor(unit.x)];
    const threatenedCity = orders.hostile(owner, unit.faction) ? nearestCity(cities.get(owner) ?? [], unit) : undefined;
    if (threatenedCity) threats.get(threatenedCity.id)?.push(unit);
    // Walls may enclose more land than the current cultural border. Intruders
    // there still belong to this post's physical defense area.
    for (const [cityId, defense] of enclosedCities) if (cityId !== threatenedCity?.id
      && orders.hostile(defense.faction, unit.faction) && insideEnclosure(state, defense.enclosure, unit))
      defense.threats.push(unit);
  }
  // Civilian rescues may extend just outside city borders. A post examines only
  // its local civilians and nearby human enemies, not every pair on the map.
  for (const defense of posts.values()) if (defense.civilians.length) {
    const known = new Set(defense.threats.map(unit => unit.id));
    const bx = Math.floor(defense.post.x / bucketSize), by = Math.floor(defense.post.y / bucketSize);
    for (let y = by - 2; y <= by + 2; y++) for (let x = bx - 2; x <= bx + 2; x++) for (const enemy of enemyBuckets.get(`${x},${y}`) ?? []) {
      if (!orders.hostile(defense.faction, enemy.faction)
        || distance(enemy, center(defense.post)) > GUARD_CIVILIAN_PROTECTION_RADIUS + GUARD_CIVILIAN_DANGER_RADIUS) continue;
      if (civilianThreat(state, defense, enemy)) {
        defense.rescueActive = true;
        if (!known.has(enemy.id)) { defense.threats.push(enemy); known.add(enemy.id); }
      }
    }
  }
  const populations = cityPopulations(state, cities), serving = new Map<number, number>();
  for (const [id, roster] of rosters) {
    const defense = posts.get(id)!;
    serving.set(defense.city.id, (serving.get(defense.city.id) ?? 0) + roster.length);
  }
  for (const defense of posts.values()) {
    const { post, city } = defense, first = !post.guardPost, wasFunded = post.guardPost?.funded === true;
    post.guardPost ??= { nextUpkeepAt: state.time + GUARD_POST_UPKEEP_INTERVAL, funded: true, needsRecruits: true };
    // Returning to valid city territory can use the remainder of an already
    // purchased service interval. A missed payment always has a past deadline.
    if (!post.guardPost.funded && post.guardPost.nextUpkeepAt > state.time) post.guardPost.funded = true;
    const replenish = collectUpkeep(state, post, factions.get(post.faction)!);
    if (wasFunded !== post.guardPost.funded) changed.add(post.faction);
    const roster = rosters.get(post.id) ?? [], capacity = guardPostCapacity(post);
    // Retire extra soldiers when either the purchased slots or city manpower
    // shrinks, without treating a return to civilian life as a casualty.
    const otherServing = (serving.get(city.id) ?? 0) - roster.length;
    const limit = Math.min(capacity, Math.max(0, (populations.get(city.id) ?? 0) - otherServing));
    for (const surplus of roster.slice(limit)) retire(surplus);
    let count = Math.min(roster.length, limit);
    serving.set(city.id, otherServing + count);
    for (const troop of roster) if (troop.hp > 0) troop.kills = post.guardPost.kills ?? 0;
    if (post.guardPost.funded && (first || replenish || post.guardPost.needsRecruits)) {
      for (; count < limit; count++) { makeMilitia(state, post, city, nextId++); serving.set(city.id, (serving.get(city.id) ?? 0) + 1); }
      post.guardPost.needsRecruits = count < capacity;
    }
  }
  frames.set(state, { posts, cities, borders, hostile: orders.hostile });
  return changed;
}

/** New threats are detected in the home city or near its civilians. Engaged
 * guards can continue a chase within twenty tiles of their post. */
export function militiaCityContains(state: GameState, unit: Unit, point: Point): boolean {
  if (isForbidden(state, point.x, point.y, unit.faction)) return false;
  const frame = frames.get(state), defense = frame?.posts.get(unit.guardPost ?? -1);
  if (!frame || !defense || !buildingReady(defense.post) || !buildingReady(defense.city)
    || defense.post.faction !== unit.faction || defense.city.faction !== unit.faction) return false;
  if (defense.post.guardPost?.wallsOnly) return insideEnclosure(state, defense.enclosure, point);
  if (!unit.inside && unit.target !== undefined && distance(point, center(defense.post)) <= GUARD_PURSUIT_RADIUS) return true;
  if (nearestCity(frame.cities.get(unit.faction) ?? [], point)?.id !== defense.city.id) return false;
  return insideOwnBorders(state, unit.faction, point.x, point.y, frame.borders)
    || defense.rescueActive
      && distance(point, center(defense.post)) <= GUARD_CIVILIAN_PROTECTION_RADIUS + GUARD_CIVILIAN_DANGER_RADIUS;
}

function validThreat(state: GameState, unit: Unit, target: Unit, frame: DefenseFrame): boolean {
  const defense = frame.posts.get(unit.guardPost ?? -1);
  if (isForbidden(state, target.x, target.y, unit.faction)) return false;
  if (!defense || buildingWorkForbidden(state, defense.post) || target.hp <= 0 || target.inside || !human(target) || !frame.hostile(unit.faction, target.faction)) return false;
  if (defense.post.guardPost?.wallsOnly) return insideEnclosure(state, defense.enclosure, target);
  const ownCity = insideOwnBorders(state, unit.faction, target.x, target.y, frame.borders)
    && nearestCity(frame.cities.get(unit.faction) ?? [], target)?.id === defense.city.id;
  return ownCity || civilianThreat(state, defense, target)
    || !unit.inside && unit.target === target.id && distance(target, center(defense.post)) <= GUARD_PURSUIT_RADIUS;
}
function deploy(state: GameState, unit: Unit, post: Building, target: Unit, canEngage?: MilitiaOrders['canEngage']): boolean {
  const exits = constructionEdges(state, post, true).filter(point => militiaCityContains(state, unit, point));
  exits.sort((a, b) => distance(a, target) - distance(b, target));
  const exit = exits.find(point => !cellOccupant(state, point, unit)
    && (!canEngage || canEngage({ ...unit, ...point, inside: false }, target)));
  if (!exit) return false;
  clearJourney(unit); unit.inside = false; unit.x = exit.x; unit.y = exit.y;
  unit.order = 'follow'; return true;
}
function returnToPost(state: GameState, unit: Unit, post: Building, dt: number, orders: MilitiaOrders): void {
  if (unit.inside) { unit.target = undefined; return; }
  if (buildingWorkForbidden(state, post)) { clearJourney(unit); unit.moving = false; return; }
  if (unit.target !== undefined) clearJourney(unit);
  let clock = returnClocks.get(unit);
  if (!clock) { clock = {}; returnClocks.set(unit, clock); }
  let goal = unit.destination;
  if (!simulationReadsActive(state) || decisionDue(clock, state.time, unit.id)) {
    const limits = militiaMovementLimits(state, unit);
    const exits = constructionEdges(state, post, true).filter(point => !limits?.has(Math.floor(point.y) * state.world.width + Math.floor(point.x)))
      .sort((a, b) => distance(a, unit) - distance(b, unit));
    if (exits.some(point => distance(unit, point) < .25)) { shelter(unit, post); return; }
    goal = exits.find(point => unit.destination && distance(point, unit.destination) < .01);
    if (!goal || !canWalk(state, goal.x, goal.y, unit.faction, undefined, true) || (unit.stuckFor ?? 0) > 2) {
      goal = exits.find(point => findPath(state, unit, point, unit.faction, false, limits, undefined, undefined, false, true).length > 0);
      if (goal) { unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; }
    }
    unit.destination = goal;
  }
  if (!goal) { unit.moving = false; return; }
  orders.move(state, unit, goal, dt);
  if (distance(unit, goal) < .25) shelter(unit, post);
}

export function updateMilitia(state: GameState, unit: Unit, dt: number, orders: MilitiaOrders): void {
  if (unit.kind !== 'militia' || unit.hp <= 0) return;
  // This unit follows its post's duty, never the Leader's retinue stance. Hold
  // also makes traffic yielding return to a stale deployment point.
  unit.order = 'follow'; unit.retinueStance = undefined; unit.defensiveAnchor = undefined;
  const frame = frames.get(state), defense = frame?.posts.get(unit.guardPost ?? -1);
  if (!frame || !defense || !buildingReady(defense.post) || defense.post.faction !== unit.faction
    || !buildingReady(defense.city) || defense.city.faction !== unit.faction) { retire(unit); return; }
  if (defense.post.guardPost?.wallsOnly && (!insideEnclosure(state, defense.enclosure, unit)
    || !insideEnclosure(state, defense.enclosure, defense.post))) {
    returnToPost(state, unit, defense.post, dt, orders); return;
  }
  let plan = militiaPlans.get(unit);
  if (!plan) { plan = {}; militiaPlans.set(unit, plan); }
  if (!simulationReadsActive(state) || decisionDue(plan, state.time, unit.id)) {
    const tracked = unit.target === undefined ? undefined : indexedUnit(state, unit.target);
    const threats = tracked && !defense.threats.includes(tracked) ? [...defense.threats, tracked] : defense.threats;
    const candidates = defense.post.guardPost?.funded
      ? threats.filter(enemy => validThreat(state, unit, enemy, frame))
        .sort((a, b) => distance(unit, a) - distance(unit, b) || a.id - b.id) : [];
    plan.target = candidates.find(enemy => unit.inside
      ? deploy(state, unit, defense.post, enemy, orders.canEngage)
      : !orders.canEngage || orders.canEngage(unit, enemy));
  }
  const cached = plan.target;
  const target = cached && cached.hp > 0 && !cached.inside && defense.post.guardPost?.funded
    && frame.hostile(unit.faction, cached.faction) && !isForbidden(state, cached.x, cached.y, unit.faction)
    && (!defense.post.guardPost?.wallsOnly || insideEnclosure(state, defense.enclosure, cached))
    && distance(cached, center(defense.post)) <= GUARD_PURSUIT_RADIUS ? cached : undefined;
  if (!target) {
    if (!unit.inside && !defense.post.guardPost?.wallsOnly && defense.post.guardPost?.funded
      && state.time < (defense.post.guardPost.lastThreatAt ?? -Infinity) + GUARD_POST_ALERT_SECONDS) {
      clearJourney(unit); return;
    }
    returnToPost(state, unit, defense.post, dt, orders); return;
  }
  if (unit.target !== target.id) clearJourney(unit);
  unit.target = target.id; unit.destination = undefined;
  // Unreachable intruders must not renew the alert forever and strand guards
  // outside. Only a threat that a guard can actually engage keeps the post alert.
  defense.post.guardPost!.lastThreatAt = state.time;
  orders.engage(unit, target, dt);
}
