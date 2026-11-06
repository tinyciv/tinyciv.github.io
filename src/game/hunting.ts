import { maximumUnitRange } from './combat-range';
import { isHumanFaction } from './player-context';
import { grantIncome } from './resource-income';
import { CITY_GROWTH_SPEED } from './economy-constants';
import { entityStore } from './entity-store';
import { isSoldier } from './types';
import { seededRandom } from '../world/generator';
import { pointInSight, updateFog } from './fog';
import { buildingBlockers, canMove, canWalk } from './pathfinding';
import { forEachNearbyUnit, indexedLeader, nearbyUnits } from './spatial';
import { buildingReady, buildingWidth, buildingHeight, distance, tileAt, WATER, type Building, type GameState, type Point, type Unit, type WildlifeHerd, type World } from './types';
import { MARSH_BIRD_FOOD_REWARD, marshBirdFlockTarget, marshFlockGoal, moveMarshBird, spawnMarshBirdFlock } from './marsh-birds';

export const WILDLIFE_FACTION = -3;
export const HUNT_FOOD_REWARD = 5;
export const HUNT_GROWTH_BONUS = .1;
export const HUNT_GROWTH_SECONDS = 30;
export const WILDLIFE_RESPAWN_MIN = 180;
export const WILDLIFE_RESPAWN_MAX = 300;
export const HERD_MAX_SIZE = 8;
export const HERD_FLEE_RADIUS = 6;
export const HERD_GRAZE_MIN_SECONDS = 22;
export const HERD_GRAZE_MAX_SECONDS = 38;
export const HERD_STROLL_SECONDS = 5;
export const HERD_STROLL_SPEED = .55;
export const HERD_RUN_SPEED = 3.15;
const grazingDuration = (random: () => number): number => HERD_GRAZE_MIN_SECONDS + random() * (HERD_GRAZE_MAX_SECONDS - HERD_GRAZE_MIN_SECONDS);

/** Five initial residents eat five food per economy tick. Eight fertile farm
 * cells yield 9.6, so ordinary growth is 1.48154 births per 30 seconds. Ten
 * percent of that costs only .5926 food at four food per birth. Five food is
 * the smallest useful positive reward rounded to five: one village meal, or
 * one birth plus a ration. The explicit timed bonus provides the exact 10%;
 * adding stock alone cannot change growth, which is based on farm yield. */
export const EARLY_HUNT_CALIBRATION = {
  population: 5, farmTiles: 8, foodPerTile: 1.2, foodPerBirth: 4,
  growthPerTick: CITY_GROWTH_SPEED * (.14 + (8 * 1.2 - 5) / 13),
};

export function isHuntable(unit: Pick<Unit, 'kind' | 'faction'>): boolean {
  return (unit.kind === 'boar' || unit.kind === 'marshBird') && unit.faction === WILDLIFE_FACTION;
}

const human = (unit: Unit): boolean => unit.hp > 0 && !unit.inside
  && (unit.kind === 'leader' || isSoldier(unit) || unit.kind === 'scout' || unit.kind === 'militia' || unit.kind === 'worker' || unit.kind === 'merchant');

/** Boar forage in vegetated, reasonably moist country. Nearby woodland offers
 * shelter and freshwater sustains open meadows; exposed cold summits, beaches,
 * ice and bare deserts cannot support a herd just because they are walkable. */
export function wildlifeHabitatSuitability(world: World, x: number, y: number): number {
  x = Math.floor(x); y = Math.floor(y);
  const tile = tileAt(world, x, y);
  if (!tile || WATER.has(tile.terrain) || tile.beach || tile.overlay === 'glacier' || tile.overlay === 'volcano'
    || tile.biome === 'alpine' || tile.biome === 'tundra' || (tile.temperature ?? .5) < .16) return 0;
  let shelter = 0, freshwater = 0, neighbors = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const neighbor = tileAt(world, x + dx, y + dy);
    if (!neighbor) continue;
    neighbors++;
    if (neighbor.overlay === 'forest' || neighbor.overlay === 'jungle') shelter++;
    if (neighbor.terrain === 'river' || neighbor.terrain === 'lake') freshwater++;
  }
  const wooded = tile.overlay === 'forest' || tile.overlay === 'jungle', wet = freshwater > 0;
  if ((tile.terrain === 'desert' || tile.biome === 'desert') && !(wooded && wet)) return 0;
  if (tile.terrain === 'tundra' && !wooded) return 0;
  const moisture = Math.max(0, Math.min(1, tile.moisture));
  if (moisture < .15 && !wet) return 0;
  const forage = .14 + moisture * .50 + (tile.fertility ?? .5) * .15;
  return Math.min(1, forage + shelter / Math.max(1, neighbors) * .28 + (wooded ? .14 : 0)
    + (wet ? .14 : 0) + (tile.overlay === 'swamp' ? .08 : 0));
}

const habitatCache = new WeakMap<World, { revision: number; scores: Float32Array; capacity: number }>();
function wildlifeHabitat(world: World): { scores: Float32Array; capacity: number } {
  const revision = world.revision ?? 0, cached = habitatCache.get(world);
  if (cached?.revision === revision) return cached;
  const scores = new Float32Array(world.tiles.length);
  let capacity = 0;
  for (let i = 0; i < scores.length; i++) {
    scores[i] = wildlifeHabitatSuitability(world, i % world.width, Math.floor(i / world.width));
    capacity += scores[i];
  }
  const habitat = { revision, scores, capacity }; habitatCache.set(world, habitat);
  return habitat;
}

/** Carrying capacity follows food and shelter, not the amount of bare land.
 * The existing cap bounds simulation work even in exceptionally lush worlds. */
export function wildlifeHerdTarget(state: GameState): number {
  const { capacity } = wildlifeHabitat(state.world);
  return capacity < 30 ? 0 : Math.min(36, Math.max(1, Math.floor(capacity / 600)));
}

function randomFor(state: GameState): () => number {
  return seededRandom(`${state.world.seed}:wildlife:${state.wildlife!.sequence++}`);
}

/** Every occupied cell must be unseen; finding a hidden center is not enough
 * when the herd straddles the edge of player sight. */
export function spawnWildlifeHerd(state: GameState): WildlifeHerd | undefined {
  if (!state.wildlife) return;
  const random = randomFor(state), fog = updateFog(state), { width, height } = state.world;
  const habitat = wildlifeHabitat(state.world).scores;
  const blockers = buildingBlockers(state, WILDLIFE_FACTION), occupied = new Set<number>();
  for (const unit of state.units) if (unit.hp > 0 && !unit.inside) occupied.add(Math.floor(unit.y) * width + Math.floor(unit.x));
  const safe = new Uint8Array(width * height), excluded = new Uint8Array(width * height);
  // Rasterize sparse exclusions once; testing every map cell against every
  // person and building becomes expensive on the larger world.
  for (const unit of state.units.filter(human)) {
    for (let y = Math.max(1, Math.floor(unit.y) - 8); y < Math.min(height - 1, unit.y + 8); y++)
      for (let x = Math.max(1, Math.floor(unit.x) - 8); x < Math.min(width - 1, unit.x + 8); x++)
        if (Math.hypot(x + .5 - unit.x, y + .5 - unit.y) < 8) excluded[y * width + x] = 1;
  }
  for (const building of state.buildings) if (building.hp > 0) {
    for (let y = Math.max(1, building.y - 3); y < Math.min(height - 1, building.y + buildingHeight(building) + 3); y++)
      for (let x = Math.max(1, building.x - 3); x < Math.min(width - 1, building.x + buildingWidth(building) + 3); x++) excluded[y * width + x] = 1;
  }
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const index = y * width + x, tile = state.world.tiles[index], point = { x: x + .5, y: y + .5 };
    if (excluded[index] || habitat[index] < .18 || WATER.has(tile.terrain) || tile.farm !== undefined || occupied.has(index)
      || !canWalk(state, point.x, point.y, WILDLIFE_FACTION, blockers) || pointInSight(fog, point.x, point.y)
      ) continue;
    safe[index] = 1;
  }
  const candidates: number[] = [];
  // Rejection sampling weights otherwise safe homes toward productive habitat.
  // All neighboring occupied cells still undergo the full safety checks below.
  for (let index = 0; index < safe.length; index++) if (safe[index] && random() < habitat[index] ** 2) candidates.push(index);
  // Shuffle the candidates once, rather than repeatedly sampling occupied cells.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const size = 1 + Math.floor(random() * HERD_MAX_SIZE);
  for (const index of candidates) {
    const home = { x: index % width + .5, y: Math.floor(index / width) + .5 };
    if (state.wildlife.herds.some(herd => distance(home, herd.waypoint) < 9)) continue;
    const cells: Point[] = [], queue = [home], visited = new Set<number>();
    for (let q = 0; q < queue.length && cells.length < size; q++) {
      const point = queue[q], cell = Math.floor(point.y) * width + Math.floor(point.x);
      if (visited.has(cell)) continue;
      visited.add(cell);
      if (!safe[cell] || distance(home, point) > 2.5) continue;
      cells.push(point);
      for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
        const next = { x: point.x + dx, y: point.y + dy };
        if (next.x > 0 && next.y > 0 && next.x < width && next.y < height
          && canMove(state, point, next, WILDLIFE_FACTION, blockers)) queue.push(next);
      }
    }
    if (cells.length < size) continue;
    const herd: WildlifeHerd = { id: Math.max(0, ...state.wildlife.herds.map(candidate => candidate.id)) + 1,
      waypoint: home, nextWanderAt: state.time + grazingDuration(random) };
    state.wildlife.herds.push(herd);
    let id = Math.max(0, ...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id));
    for (const point of cells) entityStore(state).units.add({ ...point, id: ++id, kind: 'boar', faction: WILDLIFE_FACTION,
      herdId: herd.id, hp: 14, maxHp: 14, attack: 0, defense: 0, morale: 100,
      speed: HERD_STROLL_SPEED, range: 0, order: 'wander', cooldown: 0, lastCombat: -60, moving: false,
      facing: random() * Math.PI * 2, attackTime: 0, bornAt: state.time });
    return herd;
  }
}

/** Called explicitly after initial fog calculation, never as a load migration. */
export function initializeWildlife(state: GameState): void {
  if (state.wildlife) return;
  state.wildlife = { herds: [], sequence: 0, nextRespawnAt: state.time + WILDLIFE_RESPAWN_MIN, targetHerds: wildlifeHerdTarget(state) };
  for (let i = 0; i < state.wildlife.targetHerds; i++) if (!spawnWildlifeHerd(state)) break;
  for (let i = 0, target = marshBirdFlockTarget(state); i < target; i++) if (!spawnMarshBirdFlock(state, randomFor(state))) break;
  state.wildlife.nextRespawnAt += randomFor(state)() * (WILDLIFE_RESPAWN_MAX - WILDLIFE_RESPAWN_MIN);
}

function herdGoal(state: GameState, center: Point, anchor: Unit, threat: Point | undefined, random: () => number): Point {
  if (anchor.kind === 'marshBird') return marshFlockGoal(state, anchor, center, threat, random);
  const away = threat ? Math.atan2(center.y - threat.y, center.x - threat.x) : random() * Math.PI * 2;
  // All twenty probes observe the same buildings. This function runs before
  // the shared navigation frame, so capture their blockers once locally.
  const blockers = buildingBlockers(state, WILDLIFE_FACTION);
  let best: Point = { x: anchor.x, y: anchor.y }, score = -Infinity;
  for (let attempt = 0; attempt < 20; attempt++) {
    const angle = away + (attempt ? (random() - .5) * Math.PI * 1.5 : 0), length = threat ? 4 + random() * 3 : 1 + random() * 1.5;
    const candidate = { x: Math.floor(center.x + Math.cos(angle) * length) + .5, y: Math.floor(center.y + Math.sin(angle) * length) + .5 };
    const tile = tileAt(state.world, candidate.x, candidate.y);
    if (!tile || WATER.has(tile.terrain) || !canMove(state, anchor, candidate, WILDLIFE_FACTION, blockers)) continue;
    const value = threat ? distance(candidate, threat) - distance(candidate, center) * .15
      : wildlifeHabitatSuitability(state.world, candidate.x, candidate.y) * 6 + length * .3;
    if (value > score) { score = value; best = candidate; }
  }
  return best;
}

/** One shared decision per herd every half-second, not one map search per animal. */
export function updateWildlife(state: GameState): void {
  const wildlife = state.wildlife;
  if (!wildlife) return;
  const byHerd = new Map<number, Unit[]>();
  for (const unit of state.units) if (isHuntable(unit) && unit.hp > 0 && unit.herdId !== undefined) {
    const members = byHerd.get(unit.herdId) ?? []; members.push(unit); byHerd.set(unit.herdId, members);
  }
  wildlife.herds = wildlife.herds.filter(herd => byHerd.has(herd.id));
  for (const herd of wildlife.herds) {
    if (state.time < (herd.nextThinkAt ?? 0)) continue;
    herd.nextThinkAt = state.time + .5;
    const members = byHerd.get(herd.id)!, center = { x: 0, y: 0 };
    for (const member of members) { center.x += member.x / members.length; center.y += member.y / members.length; }
    const anchor = members.reduce((nearest, member) => distance(member, center) < distance(nearest, center) ? member : nearest);
    let threat: Unit | undefined, threatDistance = Infinity;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const member of members) {
      left = Math.min(left, member.x - HERD_FLEE_RADIUS); right = Math.max(right, member.x + HERD_FLEE_RADIUS);
      top = Math.min(top, member.y - HERD_FLEE_RADIUS); bottom = Math.max(bottom, member.y + HERD_FLEE_RADIUS);
    }
    for (const unit of nearbyUnits(state, center, HERD_FLEE_RADIUS + 3)) {
      // This runs before the simulation's spatial frame. Most humans can be
      // excluded without allocating a member-distance array or taking roots.
      // Bounds cover every member, including a straggler away from the center.
      if (!human(unit) || unit.x <= left || unit.x >= right || unit.y <= top || unit.y >= bottom) continue;
      let d = Infinity;
      for (const member of members) d = Math.min(d, distance(member, unit));
      if (d < HERD_FLEE_RADIUS && d < threatDistance) { threat = unit; threatDistance = d; }
    }
    const wasFleeing = (herd.fleeUntil ?? 0) > state.time;
    const threatMoved = threat && (!herd.lastThreat || distance(threat, herd.lastThreat) > 1.5);
    if (threat) { herd.fleeUntil = state.time + 4; herd.lastThreat = { x: threat.x, y: threat.y }; }
    if ((herd.fleeUntil ?? 0) > state.time) {
      delete herd.wanderUntil;
      if (!wasFleeing || threatMoved || state.time >= herd.nextWanderAt || distance(center, herd.waypoint) < 1) {
        herd.waypoint = herdGoal(state, center, anchor, herd.lastThreat, randomFor(state));
        herd.nextWanderAt = state.time + 2;
      }
      continue;
    }
    if (herd.fleeUntil !== undefined || herd.wanderUntil !== undefined && state.time >= herd.wanderUntil) {
      delete herd.fleeUntil; delete herd.lastThreat; delete herd.wanderUntil;
      herd.waypoint = center;
      herd.nextWanderAt = state.time + grazingDuration(randomFor(state));
    } else if (herd.wanderUntil === undefined && state.time >= herd.nextWanderAt) {
      // Reaching a waypoint does not cancel the rest period. A short, slow
      // forage walk alternates with much longer grazing, even near obstacles.
      herd.waypoint = herdGoal(state, center, anchor, undefined, randomFor(state));
      herd.wanderUntil = state.time + HERD_STROLL_SECONDS;
    }
  }
  if (state.time >= wildlife.nextRespawnAt) {
    wildlife.targetHerds = wildlifeHerdTarget(state);
    if (wildlife.herds.filter(herd => herd.species !== 'marshBird').length < wildlife.targetHerds) spawnWildlifeHerd(state);
    if (wildlife.herds.filter(herd => herd.species === 'marshBird').length < marshBirdFlockTarget(state)) spawnMarshBirdFlock(state, randomFor(state));
    wildlife.nextRespawnAt = state.time + WILDLIFE_RESPAWN_MIN + randomFor(state)() * (WILDLIFE_RESPAWN_MAX - WILDLIFE_RESPAWN_MIN);
  }
  // Keep one previous economy window, so a bonus ending between ticks is still
  // credited for precisely the seconds when it was active.
  for (const building of state.buildings) if (building.huntingBonuses)
    building.huntingBonuses = building.huntingBonuses.filter(bonus => bonus.expiresAt > state.time - HUNT_GROWTH_SECONDS);
}

export function updateHerdAnimal(state: GameState, unit: Unit, dt: number,
  move: (state: GameState, unit: Unit, goal: Point, dt: number, direct?: boolean) => void): boolean {
  if (!isHuntable(unit)) return false;
  unit.moving = false;
  const herd = state.wildlife?.herds.find(candidate => candidate.id === unit.herdId);
  if (!herd) return true;
  if (unit.kind === 'marshBird') { moveMarshBird(state, unit, herd, dt); return true; }
  const fleeing = (herd.fleeUntil ?? 0) > state.time;
  unit.order = 'wander'; unit.target = undefined; unit.speed = fleeing ? HERD_RUN_SPEED : HERD_STROLL_SPEED;
  if (!fleeing && state.time >= (herd.wanderUntil ?? 0)) {
    // Rest exactly where each animal stopped. Keeping the old path or pulling
    // everyone into formation here creates constant milling while grazing.
    unit.path = undefined; unit.pathGoal = undefined; unit.destination = undefined; unit.repathAt = 0;
    return true;
  }
  // Stable nearby individual destinations prevent the whole herd competing
  // for the same cell. All members still follow one shared route direction.
  const angle = unit.id * 2.399963229728653, radius = .7 + unit.id % 3 * .4;
  let goal = { x: herd.waypoint.x + Math.cos(angle) * radius, y: herd.waypoint.y + Math.sin(angle) * radius };
  if (!canWalk(state, goal.x, goal.y, WILDLIFE_FACTION)) goal = herd.waypoint;
  if (distance(unit, goal) > .3) {
    // Herd decisions deliberately choose local, visible ground. Reuse the
    // normal movement/collision checks, but avoid a continent-sized A* grid
    // for an animal whose complete straight segment is already traversable.
    // Water, ledges, buildings, and a blocked member still use ordinary paths.
    const direct = canMove(state, unit, goal, WILDLIFE_FACTION);
    if (direct && unit.path?.length) { unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; }
    move(state, unit, goal, dt, direct);
  }
  return true;
}

/** Automatic hunts are local opportunities. A stationary guard only shoots
 * within reach, and an escort never chases game away from its Leader. Human
 * combat should be checked before calling this helper. */
export function nearestHuntTarget(state: GameState, hunter: Unit, visible: (animal: Unit) => boolean): Unit | undefined {
  if (hunter.faction < 0 || hunter.hp <= 0 || hunter.inside || hunter.attack <= 0
    || !['leader', 'warrior', 'horseman'].includes(hunter.kind) || hunter.order === 'flee' || hunter.recallIssuedAt !== undefined) return;
  // The role view changes with spawning/removal. A wildlife-free world needs
  // no spatial search, and health/allegiance are still checked on live animals.
  if (!entityStore(state).units.query('wildlife').length) return;
  const radius = hunter.order === 'hold' ? maximumUnitRange(hunter) : hunter.kind === 'leader' ? 5 : 4;
  const leader = isSoldier(hunter) ? indexedLeader(state, hunter.faction) : undefined;
  let nearest: Unit | undefined, best = Infinity;
  forEachNearbyUnit(state, hunter, radius, animal => {
    if (!isHuntable(animal) || animal.hp <= 0) return;
    const d = distance(hunter, animal);
    if (d > radius || leader && distance(leader, animal) > 5 || !visible(animal)) return;
    if (d < best || d === best && animal.id < nearest!.id) { nearest = animal; best = d; }
  });
  return nearest;
}

function nearestPalace(state: GameState, faction: number, point: Point): Building | undefined {
  let nearest: Building | undefined, best = Infinity;
  for (const palace of state.buildings) {
    if (palace.kind !== 'palace' || palace.faction !== faction || !buildingReady(palace)) continue;
    const d = Math.hypot(point.x - palace.x - 1, point.y - palace.y - 1);
    if (d < best || d === best && palace.id < nearest!.id) { nearest = palace; best = d; }
  }
  return nearest;
}

/** Call once from the ordinary death handler, before gold, veterancy or combat
 * morale rewards. Marking the carcass guards against duplicate callbacks. */
export function rewardHunt(state: GameState, hunter: Pick<Unit, 'faction'>, animal: Unit): boolean {
  if (!isHuntable(animal) || animal.hp > 0) return false;
  const faction = state.factions.find(candidate => candidate.id === hunter.faction && !candidate.defeated);
  if (!faction || animal.huntRewarded) return true;
  animal.huntRewarded = true;
  const reward = animal.kind === 'marshBird' ? MARSH_BIRD_FOOD_REWARD : HUNT_FOOD_REWARD;
  grantIncome(faction, { food: reward }, state);
  const palace = animal.kind === 'boar' ? nearestPalace(state, hunter.faction, animal) : undefined;
  if (palace) (palace.huntingBonuses ??= []).push({ startedAt: state.time, expiresAt: state.time + HUNT_GROWTH_SECONDS });
  if (isHumanFaction(state, hunter.faction)) state.particles.push({ x: animal.x, y: animal.y, text: `+${reward} food`, color: '#b9df85', life: 1.6, kind: 'hunt' });
  return true;
}

function bonusDuring(bonuses: NonNullable<Building['huntingBonuses']>, from: number, to: number): number {
  if (to <= from) return bonuses.filter(bonus => bonus.startedAt <= to && bonus.expiresAt > to).length * HUNT_GROWTH_BONUS;
  return bonuses.reduce((total, bonus) => total + Math.max(0, Math.min(to, bonus.expiresAt) - Math.max(from, bonus.startedAt))
    / (to - from) * HUNT_GROWTH_BONUS, 0);
}

/** A time-weighted rate, preserving partial economy ticks at both ends. */
export function huntingGrowthMultiplier(state: GameState, home: Building, from = state.time, to = state.time): number {
  const palace = home.kind === 'palace' ? home : nearestPalace(state, home.faction, { x: home.x + .5, y: home.y + .5 });
  return 1 + bonusDuring(palace?.huntingBonuses ?? [], from, to);
}

/** Faction food/growth are shared in the current economy. Applying this to
 * newly earned growth (rather than discounting birth costs) keeps an old bank
 * of growth from receiving a windfall when the first hunt completes. */
export function huntingGrowthMultiplierForFaction(state: GameState, faction: number, from = state.time, to = state.time): number {
  return 1 + state.buildings.filter(building => building.faction === faction && building.kind === 'palace' && buildingReady(building))
    .reduce((total, palace) => total + bonusDuring(palace.huntingBonuses ?? [], from, to), 0);
}
