import { entityStore } from './entity-store';
import { pointInSight, updateFog } from './fog';
import { buildingBlockerView, canTraverseEdge, type CellBlockers } from './pathfinding';
import { ridgeGroundWalkable } from './ridges';
import { unitCollisionRadius, unitObstructs } from './collisions';
import { nearbyUnits } from './spatial';
import { buildingHeight, buildingWidth, distance, tileAt, WATER, type GameState, type Point, type Unit, type WildlifeHerd, type World } from './types';

export const MARSH_BIRD_FOOD_REWARD = 20;
export const MARSH_FLOCK_MIN = 4;
export const MARSH_FLOCK_MAX = 8;
export const MARSH_FLOCK_LIMIT = 16;
const FACTION = -3;
const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const cellAt = (world: World, point: Point): number => Math.floor(point.y) * world.width + Math.floor(point.x);
const pointAt = (world: World, cell: number): Point => ({ x: cell % world.width + .5, y: Math.floor(cell / world.width) + .5 });

/** Spawn habitat only. Once present, birds can walk or swim across the map;
 * biome tags and the shoreline never act as invisible movement barriers. */
export function marshBirdHabitat(world: World, x: number, y: number, delta?: number): boolean {
  x = Math.floor(x); y = Math.floor(y);
  const tile = tileAt(world, x, y);
  if (!tile || tile.delta === undefined || delta !== undefined && tile.delta !== delta || tile.farm !== undefined
    || tile.ridge || tile.stair || tile.relief || tile.canyon === 'wall' || tile.overlay === 'volcano' || tile.overlay === 'glacier') return false;
  if (!WATER.has(tile.terrain)) return !!tile.marsh;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if (Math.abs(dx) + Math.abs(dy) > 3) continue;
    const neighbor = tileAt(world, x + dx, y + dy);
    if (neighbor?.marsh && neighbor.delta === tile.delta && neighbor.farm === undefined && !WATER.has(neighbor.terrain)) return true;
  }
  return false;
}

function birdCellOpen(state: GameState, point: Point, blockers: CellBlockers): boolean {
  const tile = tileAt(state.world, point.x, point.y);
  return !!tile && tile.overlay !== 'volcano' && tile.overlay !== 'glacier'
    && (!(tile.ridge || tile.stair) || ridgeGroundWalkable(state.world, Math.floor(point.x), Math.floor(point.y)))
    && !blockers.has(cellAt(state.world, point));
}

/** Sweep every crossed cell, rather than only checking a swim's destination. */
export function canMarshBirdMove(state: GameState, bird: Unit, to: Point, blockers = buildingBlockerView(state, FACTION)): boolean {
  return birdSegmentOpen(state, bird, to, blockers);
}

function birdSegmentOpen(state: GameState, bird: Point, to: Point, blockers: CellBlockers, escape = false): boolean {
  const first = cellAt(state.world, bird);
  const open = (point: Point): boolean => escape && cellAt(state.world, point) === first || birdCellOpen(state, point, blockers);
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y) || !open(bird) || !open(to)) return false;
  let x = Math.floor(bird.x), y = Math.floor(bird.y);
  const endX = Math.floor(to.x), endY = Math.floor(to.y), dx = to.x - bird.x, dy = to.y - bird.y;
  const sx = Math.sign(dx), sy = Math.sign(dy), stepX = sx ? 1 / Math.abs(dx) : Infinity, stepY = sy ? 1 / Math.abs(dy) : Infinity;
  let crossX = sx ? ((sx > 0 ? x + 1 : x) - bird.x) / dx : Infinity;
  let crossY = sy ? ((sy > 0 ? y + 1 : y) - bird.y) / dy : Infinity;
  while (x !== endX || y !== endY) {
    const old = { x, y };
    if (Math.abs(crossX - crossY) < 1e-8) {
      if (!open({ x: x + sx, y }) || !open({ x, y: y + sy })) return false;
      x += sx; y += sy; crossX += stepX; crossY += stepY;
    } else if (crossX < crossY) { x += sx; crossX += stepX; }
    else { y += sy; crossY += stepY; }
    if (!open({ x, y }) || !canTraverseEdge(state.world, old, { x, y })) return false;
  }
  return true;
}

/** A newly built structure may cover a resting bird. Exempt only its occupied
 * cell while it steps out; the escape cannot cross another solid building. */
export function marshBirdEscape(state: GameState, bird: Unit): Point | undefined {
  const blockers = buildingBlockerView(state, FACTION), center = pointAt(state.world, cellAt(state.world, bird));
  return DIRECTIONS.map(([dx, dy]) => ({ x: center.x + dx, y: center.y + dy }))
    .filter(point => birdCellOpen(state, point, blockers) && birdSegmentOpen(state, bird, point, blockers, true))
    .sort((a, b) => distance(bird, a) - distance(bird, b))[0];
}

function reachable(state: GameState, start: Point, radius: number, blockers: CellBlockers): Map<number, number> {
  const first = cellAt(state.world, start), parents = new Map<number, number>();
  if (!birdCellOpen(state, start, blockers)) return parents;
  parents.set(first, -1);
  const queue = [first];
  for (let cursor = 0; cursor < queue.length && cursor < 768; cursor++) {
    const cell = queue[cursor], point = pointAt(state.world, cell);
    for (const [dx, dy] of DIRECTIONS) {
      const next = { x: point.x + dx, y: point.y + dy }, index = cellAt(state.world, next);
      if (parents.has(index) || distance(start, next) > radius || !birdCellOpen(state, next, blockers)
        || !canTraverseEdge(state.world, point, next)) continue;
      parents.set(index, cell); queue.push(index);
    }
  }
  return parents;
}

function capacities(world: World): Map<number, number> {
  const counts = new Map<number, number>();
  for (const tile of world.tiles) if (tile.marsh && tile.delta !== undefined && !WATER.has(tile.terrain) && tile.farm === undefined)
    counts.set(tile.delta, (counts.get(tile.delta) ?? 0) + 1);
  return new Map([...counts].filter(([, count]) => count >= 16).map(([delta, count]) => [delta, Math.min(3, Math.max(1, Math.floor(count / 70)))]));
}
export function marshBirdFlockTarget(state: GameState): number {
  return Math.min(MARSH_FLOCK_LIMIT, [...capacities(state.world).values()].reduce((sum, count) => sum + count, 0));
}

export function spawnMarshBirdFlock(state: GameState, random: () => number): WildlifeHerd | undefined {
  if (!state.wildlife) return;
  const flocks = state.wildlife.herds.filter(herd => herd.species === 'marshBird');
  if (flocks.length >= MARSH_FLOCK_LIMIT) return;
  const limits = capacities(state.world), fog = updateFog(state), blockers = buildingBlockerView(state, FACTION);
  const occupied = new Set(state.units.filter(unit => unit.hp > 0 && !unit.inside).map(unit => cellAt(state.world, unit)));
  const humans = state.units.filter(unit => unit.hp > 0 && !unit.inside && unit.faction !== FACTION);
  const safe = (point: Point, delta: number): boolean => marshBirdHabitat(state.world, point.x, point.y, delta) && birdCellOpen(state, point, blockers)
    && !occupied.has(cellAt(state.world, point)) && !pointInSight(fog, point.x, point.y)
    && !humans.some(unit => distance(unit, point) < 8)
    && !state.buildings.some(building => building.hp > 0 && point.x >= building.x - 3 && point.x < building.x + buildingWidth(building) + 3
      && point.y >= building.y - 3 && point.y < building.y + buildingHeight(building) + 3);
  const candidates = state.world.tiles.flatMap((tile, cell) => tile.marsh && tile.delta !== undefined
    && flocks.filter(flock => flock.delta === tile.delta).length < (limits.get(tile.delta) ?? 0) ? [cell] : []);
  for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  const size = MARSH_FLOCK_MIN + Math.floor(random() * (MARSH_FLOCK_MAX - MARSH_FLOCK_MIN + 1));
  for (const cell of candidates) {
    const home = pointAt(state.world, cell), delta = state.world.tiles[cell].delta!;
    if (!safe(home, delta) || flocks.some(flock => distance(home, flock.waypoint) < 6)) continue;
    const cells = [...reachable(state, home, 3.5, blockers).keys()].map(index => pointAt(state.world, index)).filter(point => safe(point, delta)).slice(0, size);
    if (cells.length < size) continue;
    const flock: WildlifeHerd = { id: Math.max(0, ...state.wildlife.herds.map(herd => herd.id)) + 1,
      species: 'marshBird', delta, waypoint: home, nextWanderAt: state.time + 5 + random() * 9 };
    state.wildlife.herds.push(flock);
    let id = Math.max(0, ...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id));
    for (const point of cells) entityStore(state).units.add({ ...point, id: ++id, kind: 'marshBird', faction: FACTION,
      herdId: flock.id, hp: 8, maxHp: 8, attack: 0, defense: 0, morale: 100, speed: .75, range: 0, order: 'wander',
      cooldown: 0, lastCombat: -60, moving: false, facing: random() * Math.PI * 2, attackTime: 0, bornAt: state.time });
    return flock;
  }
}

/** A flock stays locally coherent without treating marsh tags or shorelines as walls. */
export function marshFlockGoal(state: GameState, anchor: Unit, center: Point, threat: Point | undefined, random: () => number): Point {
  const points = [...reachable(state, anchor, threat ? 7 : 3, buildingBlockerView(state, FACTION)).keys()];
  let goal = { x: anchor.x, y: anchor.y }, score = -Infinity;
  for (const cell of points) {
    const point = pointAt(state.world, cell), d = distance(point, center);
    const value = threat ? distance(point, threat) - d * .15 + random() * .2 : random() + Math.min(2, d) * .35;
    if (value > score) { score = value; goal = point; }
  }
  return goal;
}

/** Birds use equal walk/swim speeds and costs, independent of soldier navigation.
 * Clear stretches are direct; blocked stretches use a bounded local path search. */
export function moveMarshBird(state: GameState, bird: Unit, flock: WildlifeHerd, dt: number): void {
  const fleeing = (flock.fleeUntil ?? 0) > state.time, blockers = buildingBlockerView(state, FACTION);
  bird.order = 'wander'; bird.target = undefined; bird.moving = false; bird.speed = fleeing ? 2.6 : .75;
  if (!birdCellOpen(state, bird, blockers)) {
    bird.path = undefined; bird.pathGoal = undefined;
    const refuge = marshBirdEscape(state, bird);
    if (!refuge) {
      // Habitat loss is emigration, never a free hunt or a combat casualty.
      bird.hp = 0; bird.huntRewarded = true; entityStore(state).units.updateRoles(bird); return;
    }
    const d = distance(bird, refuge), step = Math.min(Math.max(0, dt) * 2.6, d);
    const to = { x: bird.x + (refuge.x - bird.x) * step / d, y: bird.y + (refuge.y - bird.y) * step / d };
    if (step > 0 && birdSegmentOpen(state, bird, to, blockers, true)) {
      bird.facing = Math.atan2(to.y - bird.y, to.x - bird.x); bird.x = to.x; bird.y = to.y; bird.moving = true;
    }
    return;
  }
  if (!fleeing && state.time >= (flock.wanderUntil ?? 0)) { bird.path = undefined; bird.pathGoal = undefined; return; }
  const angle = bird.id * 2.399963229728653;
  let goal = { x: Math.floor(flock.waypoint.x + Math.cos(angle) * 1.4) + .5, y: Math.floor(flock.waypoint.y + Math.sin(angle) * 1.4) + .5 };
  if (!birdCellOpen(state, goal, blockers)) goal = flock.waypoint;
  if (!bird.pathGoal || distance(bird.pathGoal, goal) > .1 || !bird.path?.length && distance(bird, goal) > .3 && state.time >= (bird.repathAt ?? 0)) {
    if (distance(bird, goal) <= 12 && birdSegmentOpen(state, bird, goal, blockers)) bird.path = [{ ...goal }];
    else {
      const parents = reachable(state, bird, 12, blockers);
      let closest = -1, best = Infinity;
      for (const cell of parents.keys()) { const d = distance(pointAt(state.world, cell), goal); if (d < best) { best = d; closest = cell; } }
      const path: Point[] = [];
      for (let cell = closest; cell >= 0 && parents.get(cell) !== -1; cell = parents.get(cell)!) path.push(pointAt(state.world, cell));
      bird.path = path.reverse();
    }
    bird.pathGoal = { ...goal }; bird.repathAt = state.time + 1;
  }
  let remaining = Math.max(0, dt) * bird.speed;
  while (remaining > .0001 && bird.path?.length) {
    const next = bird.path[0], d = distance(bird, next);
    if (d < .001) { bird.path.shift(); continue; }
    const step = Math.min(remaining, d, .2), to = { x: bird.x + (next.x - bird.x) * step / d, y: bird.y + (next.y - bird.y) * step / d };
    if (!canMarshBirdMove(state, bird, to, blockers)) { bird.path = undefined; bird.pathGoal = undefined; break; }
    if (nearbyUnits(state, to, 1).some(other => unitObstructs(bird, other) && distance(to, other) < unitCollisionRadius(bird) + unitCollisionRadius(other)
      && distance(to, other) < distance(bird, other) - .001)) break;
    bird.facing = Math.atan2(to.y - bird.y, to.x - bird.x); bird.x = to.x; bird.y = to.y; bird.moving = true;
    remaining -= step;
    if (d <= step + .001) bird.path.shift();
  }
}
