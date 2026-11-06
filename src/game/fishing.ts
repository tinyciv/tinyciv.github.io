import { cityOwnership } from './city-ownership';
import { dockBerth, dockMoorings } from './dock';
import { galleyOverlapsTile } from './galley-footprint';
import { ECONOMY_INTERVAL } from './economy-constants';
import { entityStore } from './entity-store';
import { canTraverseEdge } from './pathfinding';
import { grantIncome } from './resource-income';
import { navigableWaterCell } from './water-navigation';
import { worldRevisions } from './world-revisions';
import { decisionDue, type DecisionClock } from './decision-schedule';
import { simulationReadsActive } from './simulation-reads';
import { buildingHeight, buildingReady, buildingWidth, distance, tileAt, WATER, type Building, type GameState, type Point, type World } from './types';

export const FISH_FOOD = 5;
export const FISHING_ZONE_POPULATION = 25;
/** 25 residents consume 25 food/30s. Five food per fish and a mean six-second
 * exponential arrival produce 25 food per economy period on average. */
export const FISH_RESPAWN_MEAN_SECONDS = FISH_FOOD * ECONOMY_INTERVAL / FISHING_ZONE_POPULATION;
export const FISHING_ZONE_CAPACITY = 8;
export const FISHING_ZONE_SPACING = 12;
export const FISHING_MAX_ZONES = 64;
export const FISHING_BOAT_SPEED = 3.3;
export const FISHING_BOAT_TURN_SPEED = 1.15;
const FISHING_ACCELERATION = 2.6, FISHING_BRAKING = 4.5;
export const FISHING_BOAT_CAPACITY = FISH_FOOD * 4;
/** Nets reach adjacent fish without steering the hull onto a moving point. */
export const FISHING_CATCH_RADIUS = .4;
export const FISHING_BOAT_RANGE = 32;
export const FISHING_BOAT_REPLACE_SECONDS = 30;
export const FISHING_INCOME_WINDOW = 90;
const MIN_ZONE_CELLS = 12, INITIAL_FISH = 2;
const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

export interface FishingZone { id: number; cells: number[]; nextSpawnAt: number; rngState: number; spawnAttempts: number }
export interface FishingFish extends Point {
  id: number; zone: number; food: number; spawnedAt: number; facing: number; claimedBy?: number;
  /** A short water-only patrol, evaluated from time so saves/frame sizes agree. */
  swim?: { origin: Point; end: Point };
}
export interface FishingBoat extends Point {
  id: number; dock: number; city: number; faction: number; hp: number; home: Point;
  phase: 'idle' | 'outbound' | 'returning'; cargo: number; facing: number; moving: boolean;
  target?: number; path: Point[]; nextPlanAt: number; firstCatchAt?: number;
  forwardSpeed?: number;
}
export interface FishingState {
  seed: string; startedAt: number; sequence: number; zones: FishingZone[]; fish: FishingFish[]; boats: FishingBoat[];
  receipts: { city: number; faction: number; at: number; food: number }[];
  replacements: Record<number, number>;
}
interface HomeRoutes { cell: number; distance: Int16Array; previous: Int32Array }
interface WaterNavigation {
  world: World; tiles: World['tiles']; geometry: number; structures: string; open: Uint8Array; edges: Uint8Array;
  component: Int32Array; groups: number[][]; homes: Map<number, HomeRoutes>;
  seen: Uint32Array; previous: Int32Array; queue: Int32Array; stamp: number;
}
interface NavigationRecord {
  nav?: WaterNavigation; buildingRevision: number; rawRevision?: number;
  blocked: Set<number>; structures: string; buildings: Building[];
}
const navigationRecords = new WeakMap<GameState, NavigationRecord>();
const maintenanceClocks = new WeakMap<FishingState, DecisionClock>();
const fishSearchClocks = new WeakMap<FishingBoat, DecisionClock>();
const fishIndexes = new WeakMap<FishingState, { source: FishingFish[]; values: Map<number, FishingFish> }>();
function fishingFish(state: GameState, id: number | undefined): FishingFish | undefined {
  const fishing = state.fishing!;
  let index = fishIndexes.get(fishing);
  if (!index || index.source !== fishing.fish) {
    index = { source: fishing.fish, values: new Map(fishing.fish.map(fish => [fish.id, fish])) };
    fishIndexes.set(fishing, index);
  }
  return index.values.get(id ?? -1);
}
const statistics = new WeakMap<GameState, { navigationBuilds: number; homeSearches: number; fishSearches: number; expanded: number }>();
export function fishingNavigationStats(state: GameState) {
  return { ...(statistics.get(state) ?? { navigationBuilds: 0, homeSearches: 0, fishSearches: 0, expanded: 0 }) };
}
function stats(state: GameState) {
  let value = statistics.get(state);
  if (!value) { value = { navigationBuilds: 0, homeSearches: 0, fishSearches: 0, expanded: 0 }; statistics.set(state, value); }
  return value;
}
const cellAt = (world: World, point: Point): number => Math.floor(point.y) * world.width + Math.floor(point.x);
const pointAt = (world: World, cell: number): Point => ({ x: cell % world.width + .5, y: Math.floor(cell / world.width) + .5 });
function hash(seed: string): number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i++) value = Math.imul(value ^ seed.charCodeAt(i), 16777619);
  return value >>> 0;
}
function random(zone: FishingZone): number {
  zone.rngState = (Math.imul(zone.rngState, 1664525) + 1013904223) >>> 0;
  return (zone.rngState + .5) / 4294967296;
}
function nextArrival(zone: FishingZone): number { return -Math.log(1 - random(zone)) * FISH_RESPAWN_MEAN_SECONDS; }

/** Share water geometry between every dock. Ordinary road/house changes only
 * recheck the tiny set of water blockers; they never rebuild ocean navigation. */
function navigation(state: GameState): WaterNavigation {
  const { world } = state, geometry = worldRevisions(world).geometry, revision = entityStore(state).buildings.revision;
  let record = navigationRecords.get(state);
  if (!record) {
    record = { buildingRevision: -1, blocked: new Set(), structures: '', buildings: [] }; navigationRecords.set(state, record);
  }
  if (!record.nav || record.nav.world !== world || record.nav.geometry !== geometry || record.buildingRevision !== revision
    || record.rawRevision !== world.revision || record.buildings.some(building => building.hp <= 0)) {
    const blocked = new Set<number>(), buildings: Building[] = [];
    for (const building of state.buildings) {
      if (building.hp <= 0 || building.kind === 'irrigation') continue;
      let relevant = false;
      for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++) {
        const x = building.x + dx, y = building.y + dy;
        if (WATER.has(tileAt(world, x, y)?.terrain!)) { blocked.add(y * world.width + x); relevant = true; }
      }
      if (building.kind === 'dock') { blocked.add(cellAt(world, dockBerth(building))); relevant = true; }
      if (relevant) buildings.push(building);
    }
    record.blocked = blocked; record.structures = [...blocked].sort((a, b) => a - b).join(','); record.buildings = buildings;
    record.buildingRevision = revision; record.rawRevision = world.revision;
  }
  const old = record.nav;
  if (old && old.world === world && old.tiles === world.tiles && old.geometry === geometry && old.structures === record.structures) return old;
  const count = world.width * world.height, open = new Uint8Array(count), edges = new Uint8Array(count), component = new Int32Array(count);
  component.fill(-1);
  for (let cell = 0; cell < count; cell++) {
    const x = cell % world.width, y = Math.floor(cell / world.width);
    if (!record.blocked.has(cell) && navigableWaterCell(world, x, y)) open[cell] = 1;
  }
  for (let cell = 0; cell < count; cell++) if (open[cell]) {
    const point = pointAt(world, cell);
    for (let side = 0; side < 4; side++) {
      const [dx, dy] = DIRECTIONS[side], x = Math.floor(point.x) + dx, y = Math.floor(point.y) + dy;
      if (x >= 0 && y >= 0 && x < world.width && y < world.height && open[y * world.width + x]
        && canTraverseEdge(world, point, { x: point.x + dx, y: point.y + dy })) edges[cell] |= 1 << side;
    }
  }
  const groups: number[][] = [], offsets = [-world.width, 1, world.width, -1];
  for (let cell = 0; cell < count; cell++) if (open[cell] && component[cell] < 0) {
    const group = [cell], id = groups.length; groups.push(group); component[cell] = id;
    for (let i = 0; i < group.length; i++) for (let side = 0; side < 4; side++) if (edges[group[i]] & (1 << side)) {
      const next = group[i] + offsets[side];
      if (component[next] < 0) { component[next] = id; group.push(next); }
    }
  }
  stats(state).navigationBuilds++;
  return record.nav = { world, tiles: world.tiles, geometry, structures: record.structures, open, edges, component, groups,
    homes: new Map(), seen: new Uint32Array(count), previous: new Int32Array(count), queue: new Int32Array(count), stamp: 0 };
}

function homeRoutes(state: GameState, nav: WaterNavigation, home: Point): HomeRoutes | undefined {
  const cell = cellAt(state.world, home);
  if (!nav.open[cell]) return;
  const cached = nav.homes.get(cell); if (cached) return cached;
  const distances = new Int16Array(nav.open.length), previous = new Int32Array(nav.open.length);
  distances.fill(-1); previous.fill(-1); distances[cell] = 0;
  const queue = [cell], offsets = [-state.world.width, 1, state.world.width, -1];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (distances[current] >= FISHING_BOAT_RANGE) continue;
    for (let side = 0; side < 4; side++) if (nav.edges[current] & (1 << side)) {
      const next = current + offsets[side]; if (distances[next] >= 0) continue;
      distances[next] = distances[current] + 1; previous[next] = current; queue.push(next);
    }
  }
  const value = { cell, distance: distances, previous }; nav.homes.set(cell, value); stats(state).homeSearches++;
  return value;
}
function returnPath(state: GameState, nav: WaterNavigation, boat: FishingBoat): Point[] {
  const home = homeRoutes(state, nav, boat.home), start = cellAt(state.world, boat), path: Point[] = [];
  if (!home || home.distance[start] < 0) return path;
  const center = pointAt(state.world, start);
  if (distance(boat, center) > 1e-7) path.push(center);
  for (let cell = start; cell !== home.cell; cell = home.previous[cell]) path.push(pointAt(state.world, home.previous[cell]));
  return path;
}

function spawnFish(state: GameState, zone: FishingZone, at: number, nav: WaterNavigation): void {
  const fishing = state.fishing!, offset = Math.floor(random(zone) * zone.cells.length), facing = random(zone) < .5 ? 0 : Math.PI;
  const existing = fishing.fish.filter(fish => fish.zone === zone.id);
  if (existing.length >= FISHING_ZONE_CAPACITY) return;
  const occupied = new Set(fishing.fish.map(fish => cellAt(state.world, fish.swim?.origin ?? fish)));
  for (let i = 0; i < zone.cells.length; i++) {
    const cell = zone.cells[(i + offset) % zone.cells.length];
    if (!nav.open[cell] || occupied.has(cell)) continue;
    fishing.fish.push({ id: ++fishing.sequence, zone: zone.id, ...pointAt(state.world, cell), food: FISH_FOOD, spawnedAt: at, facing });
    return;
  }
}

/** Fish meander slowly between neighboring water-cell centers. Their patrol
 * never crosses land, fords, cliffs or bridges, and consumes no spawning RNG. */
function swimFish(state: GameState, nav: WaterNavigation, fish: FishingFish): void {
  const originCell = fish.swim && cellAt(state.world, fish.swim.origin), endCell = fish.swim && cellAt(state.world, fish.swim.end);
  const edge = fish.swim && DIRECTIONS.findIndex(([dx, dy]) => fish.swim!.end.x - fish.swim!.origin.x === dx && fish.swim!.end.y - fish.swim!.origin.y === dy);
  const valid = originCell !== undefined && endCell !== undefined && nav.open[originCell] && nav.open[endCell]
    && (originCell === endCell || edge !== undefined && edge >= 0 && !!(nav.edges[originCell] & (1 << edge)));
  if (!valid) {
    const cell = cellAt(state.world, fish), origin = pointAt(state.world, cell), first = Math.imul(fish.id, 7) & 3;
    let end = origin;
    for (let i = 0; i < 4; i++) {
      const side = (first + i) & 3;
      if (!(nav.edges[cell] & (1 << side))) continue;
      const [dx, dy] = DIRECTIONS[side]; end = { x: origin.x + dx, y: origin.y + dy }; break;
    }
    fish.swim = { origin, end };
  }
  const { origin, end } = fish.swim!, age = Math.max(0, state.time - fish.spawnedAt);
  const phase = age * Math.PI / (5 + fish.id % 4), amount = (1 - Math.cos(phase)) * .5;
  fish.x = origin.x + (end.x - origin.x) * amount; fish.y = origin.y + (end.y - origin.y) * amount;
  const sign = Math.sin(phase) < 0 ? -1 : 1;
  fish.facing = Math.atan2((end.y - origin.y) * sign, (end.x - origin.x) * sign);
}

/** Zones are shared, finite natural resources. Docks never create another
 * production stream, and their outlines/footprints are not rendered. */
export function initializeFishing(state: GameState): void {
  if (state.fishing) return;
  const nav = navigation(state), { width } = state.world;
  const groups = new Map<string, number[]>();
  for (let cell = 0; cell < nav.open.length; cell++) if (nav.open[cell]) {
    const x = cell % width, y = Math.floor(cell / width), key = `${nav.component[cell]}:${Math.floor(x / FISHING_ZONE_SPACING)},${Math.floor(y / FISHING_ZONE_SPACING)}`;
    const group = groups.get(key) ?? []; group.push(cell); groups.set(key, group);
  }
  const candidates: { cells: number[]; score: number }[] = [], represented = new Set<number>();
  for (const [key, cells] of groups) if (cells.length >= MIN_ZONE_CELLS) {
    candidates.push({ cells, score: hash(`${state.seed}:fishing:${key}`) }); represented.add(nav.component[cells[0]]);
  }
  for (let id = 0; id < nav.groups.length; id++) if (!represented.has(id) && nav.groups[id].length >= MIN_ZONE_CELLS)
    candidates.push({ cells: nav.groups[id], score: hash(`${state.seed}:fishing:small:${id}`) });
  candidates.sort((a, b) => a.score - b.score || a.cells[0] - b.cells[0]);
  state.fishing = { seed: state.seed, startedAt: state.time, sequence: 0, zones: [], fish: [], boats: [], receipts: [], replacements: {} };
  for (const candidate of candidates.slice(0, FISHING_MAX_ZONES)) {
    const zone: FishingZone = { id: state.fishing.zones.length + 1, cells: candidate.cells, rngState: candidate.score,
      nextSpawnAt: state.time, spawnAttempts: 0 };
    state.fishing.zones.push(zone);
    for (let i = 0; i < INITIAL_FISH; i++) spawnFish(state, zone, state.time, nav);
    zone.nextSpawnAt = state.time + nextArrival(zone);
  }
}

function releaseTarget(state: GameState, boat: FishingBoat): void {
  const fish = fishingFish(state, boat.target);
  if (fish?.claimedBy === boat.id) delete fish.claimedBy;
  boat.target = undefined; boat.path = [];
}
function maintainBoats(state: GameState, nav: WaterNavigation): void {
  const fishing = state.fishing!, docks = new Map(state.buildings.filter(building => building.kind === 'dock' && buildingReady(building)).map(dock => [dock.id, dock]));
  const ownership = cityOwnership(state), existing = new Set<number>();
  fishing.boats = fishing.boats.filter(boat => {
    const dock = docks.get(boat.dock), city = dock && ownership.building(dock);
    if (!dock || dock.faction !== boat.faction || !city || boat.hp <= 0 || existing.has(boat.dock)) {
      releaseTarget(state, boat);
      if (boat.hp <= 0 && dock?.faction === boat.faction) fishing.replacements[boat.dock] = state.time + FISHING_BOAT_REPLACE_SECONDS;
      return false;
    }
    existing.add(dock.id); boat.city = city.id;
    if (!nav.open[cellAt(state.world, boat.home)]) {
      const mooring = dockMoorings(state, dock).find(point => nav.open[cellAt(state.world, point)]);
      if (mooring) { boat.home = mooring; releaseTarget(state, boat); boat.phase = 'returning'; }
    }
    return true;
  });
  for (const dock of docks.values()) {
    if (existing.has(dock.id) || state.time < (fishing.replacements[dock.id] ?? 0)
      || !state.factions.some(faction => faction.id === dock.faction && !faction.defeated)) continue;
    const city = ownership.building(dock); if (!city) continue;
    const moorings = dockMoorings(state, dock).filter(point => nav.open[cellAt(state.world, point)]);
    const home = moorings.find(point => !state.units.some(unit => unit.kind === 'sailboat' && unit.hp > 0
      && galleyOverlapsTile(unit, Math.floor(point.x), Math.floor(point.y))));
    if (!home) continue;
    fishing.boats.push({ id: ++fishing.sequence, dock: dock.id, city: city.id, faction: dock.faction, hp: 80,
      ...home, home: { ...home }, phase: 'idle', cargo: 0, path: [], nextPlanAt: state.time, facing: 0, moving: false });
  }
  const boats = new Map(fishing.boats.map(boat => [boat.id, boat]));
  for (const fish of fishing.fish) if (fish.claimedBy !== undefined && boats.get(fish.claimedBy)?.target !== fish.id) delete fish.claimedBy;
}

/** Bounded water-only flood search picks the closest actual swimming route,
 * never a straight-line target on the other side of an island or bridge. */
function chooseFish(state: GameState, nav: WaterNavigation, boat: FishingBoat): boolean | undefined {
  if (simulationReadsActive(state)) {
    let clock = fishSearchClocks.get(boat);
    if (!clock) { clock = {}; fishSearchClocks.set(boat, clock); }
    if (!decisionDue(clock, state.time, boat.id)) return;
  }
  const home = homeRoutes(state, nav, boat.home), start = cellAt(state.world, boat), targets = new Map<number, FishingFish>();
  if (!home || home.distance[start] < 0) return false;
  for (const fish of state.fishing!.fish) if (fish.claimedBy === undefined && home.distance[cellAt(state.world, fish)] >= 0)
    targets.set(cellAt(state.world, fish), fish);
  if (!targets.size) return false;
  stats(state).fishSearches++;
  if (++nav.stamp >= 0xffffffff) { nav.seen.fill(0); nav.stamp = 1; }
  const offsets = [-state.world.width, 1, state.world.width, -1];
  let head = 0, tail = 1; nav.queue[0] = start; nav.seen[start] = nav.stamp; nav.previous[start] = -1;
  while (head < tail) {
    const cell = nav.queue[head++]; stats(state).expanded++;
    const fish = targets.get(cell);
    if (fish) {
      const path: Point[] = [];
      for (let step = cell; step !== start; step = nav.previous[step]) path.push(pointAt(state.world, step));
      path.reverse();
      const center = pointAt(state.world, start); if (distance(boat, center) > 1e-7) path.unshift(center);
      if (distance(path.at(-1) ?? boat, fish) > 1e-7) path.push({ x: fish.x, y: fish.y });
      boat.target = fish.id; fish.claimedBy = boat.id; boat.path = path; boat.phase = 'outbound'; return true;
    }
    for (let side = 0; side < 4; side++) if (nav.edges[cell] & (1 << side)) {
      const next = cell + offsets[side];
      if (home.distance[next] < 0 || nav.seen[next] === nav.stamp) continue;
      nav.seen[next] = nav.stamp; nav.previous[next] = cell; nav.queue[tail++] = next;
    }
  }
  return false;
}

function collectFish(state: GameState, nav: WaterNavigation, boat: FishingBoat, fish: FishingFish): void {
  boat.cargo += fish.food; boat.firstCatchAt ??= state.time;
  state.fishing!.fish = state.fishing!.fish.filter(candidate => candidate !== fish); boat.target = undefined; boat.path = [];
  if (boat.cargo >= FISHING_BOAT_CAPACITY || state.time - boat.firstCatchAt > 10) boat.phase = 'returning';
  else {
    const choice = chooseFish(state, nav, boat);
    if (choice !== true) boat.phase = choice === false ? 'returning' : 'idle';
  }
}
function clearWaterSegment(state: GameState, nav: WaterNavigation, from: Point, to: Point): boolean {
  const steps = Math.max(1, Math.ceil(distance(from, to) / .12));
  let previous = cellAt(state.world, from);
  if (!nav.open[previous]) return false;
  for (let index = 1; index <= steps; index++) {
    const point = { x: from.x + (to.x - from.x) * index / steps, y: from.y + (to.y - from.y) * index / steps };
    const cell = cellAt(state.world, point);
    if (!nav.open[cell]) return false;
    if (cell !== previous) {
      const side = DIRECTIONS.findIndex(([dx, dy]) => cell === previous + dy * state.world.width + dx);
      if (side >= 0) { if (!(nav.edges[previous] & (1 << side))) return false; }
      else {
        // Crossing an exact grid corner needs both neighboring water cells;
        // never cut across the land corner of a narrow channel.
        const dx = cell % state.world.width - previous % state.world.width;
        const dy = Math.floor(cell / state.world.width) - Math.floor(previous / state.world.width);
        if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) return false;
        const horizontal = dx > 0 ? 1 : 3, vertical = dy > 0 ? 2 : 0;
        if (!(nav.edges[previous] & (1 << horizontal)) || !(nav.edges[previous] & (1 << vertical))
          || !(nav.edges[previous + dx] & (1 << vertical)) || !(nav.edges[previous + dy * state.world.width] & (1 << horizontal))) return false;
      }
    }
    previous = cell;
  }
  return true;
}

/** A hull turns before advancing: route waypoints are not velocity vectors.
 * Short swept steps retain narrow-channel navigation without sideways slides. */
export function sailFishingBoat(state: GameState, nav: WaterNavigation, boat: FishingBoat, dt: number): void {
  boat.moving = false;
  for (let remaining = Math.max(0, dt); remaining > 1e-7;) {
    const stepTime = Math.min(.05, remaining); remaining -= stepTime;
    while (boat.path.length && distance(boat, boat.path[0]) < .035) boat.path.shift();
    // Follow the furthest visible point of the water route. Re-centering in
    // each cell makes a turning hull reverse repeatedly after catching a fish.
    for (let index = Math.min(boat.path.length - 1, 8); index > 0; index--) {
      const next = boat.path[index];
      if (distance(boat, next) <= 6 && clearWaterSegment(state, nav, boat, next)) { boat.path.splice(0, index); break; }
    }
    const goal = boat.path[0];
    if (!goal) { boat.forwardSpeed = 0; break; }
    // Momentum can carry the hull to the outside of a corner even though the
    // original cell-center route was clear. Replan from its actual cell instead
    // of forever steering through the dock or bank that now blocks the segment.
    if (!clearWaterSegment(state, nav, boat, goal)) {
      boat.path = []; boat.forwardSpeed = 0; boat.nextPlanAt = state.time; break;
    }
    const gap = distance(boat, goal), heading = Math.atan2(goal.y - boat.y, goal.x - boat.x);
    const delta = Math.atan2(Math.sin(heading - boat.facing), Math.cos(heading - boat.facing));
    boat.facing += Math.max(-FISHING_BOAT_TURN_SPEED * stepTime, Math.min(FISHING_BOAT_TURN_SPEED * stepTime, delta));
    boat.facing = Math.atan2(Math.sin(boat.facing), Math.cos(boat.facing));
    const error = Math.atan2(Math.sin(heading - boat.facing), Math.cos(heading - boat.facing));
    const desired = Math.min(FISHING_BOAT_SPEED, Math.sqrt(2 * FISHING_BRAKING * Math.max(0, gap - .015)))
      * Math.pow(Math.max(0, Math.cos(error)), 8);
    const oldSpeed = boat.forwardSpeed ?? 0, acceleration = desired < oldSpeed ? FISHING_BRAKING : FISHING_ACCELERATION;
    boat.forwardSpeed = oldSpeed + Math.max(-acceleration * stepTime, Math.min(acceleration * stepTime, desired - oldSpeed));
    const step = Math.min(gap, boat.forwardSpeed * stepTime);
    const next = { x: boat.x + Math.cos(boat.facing) * step, y: boat.y + Math.sin(boat.facing) * step };
    if (Math.abs(error) < .03 && gap <= step + .035) { next.x = goal.x; next.y = goal.y; }
    if (!clearWaterSegment(state, nav, boat, next)) { boat.forwardSpeed = 0; continue; }
    boat.moving ||= distance(boat, next) > .0001; boat.x = next.x; boat.y = next.y;
    if (distance(boat, goal) < .035) { boat.path.shift(); boat.forwardSpeed = 0; }
  }
}

/** Fish never count as food until a vessel physically returns to its own dock.
 * Returns delivered food so the caller can invalidate any city-summary scope. */
export function updateFishing(state: GameState, dt: number): number {
  initializeFishing(state);
  const fishing = state.fishing!;
  let clock = maintenanceClocks.get(fishing);
  if (!clock) { clock = {}; maintenanceClocks.set(fishing, clock); }
  const maintain = !simulationReadsActive(state) || decisionDue(clock, state.time, 127);
  const nav = maintain ? navigation(state) : navigationRecords.get(state)!.nav!;
  if (maintain) {
    fishing.fish = fishing.fish.filter(fish => nav.open[cellAt(state.world, fish)]);
    // Always advance full-stock clocks too. Harvesting a full zone cannot unleash
    // a backlog of missed births, and all zones consume events chronologically.
    for (;;) {
      let next: FishingZone | undefined;
      for (const zone of fishing.zones) if (zone.nextSpawnAt <= state.time && (!next || zone.nextSpawnAt < next.nextSpawnAt
        || zone.nextSpawnAt === next.nextSpawnAt && zone.id < next.id)) next = zone;
      if (!next) break;
      spawnFish(state, next, next.nextSpawnAt, nav); next.spawnAttempts++; next.nextSpawnAt += nextArrival(next);
    }
    // Spawning mutates the fish array in place; publish a fresh lookup after
    // the batch before any boats release or acquire claims.
    fishIndexes.delete(fishing);
    maintainBoats(state, nav);
    fishing.receipts = fishing.receipts.filter(receipt => receipt.at > state.time - FISHING_INCOME_WINDOW);
  }
  for (const fish of fishing.fish) swimFish(state, nav, fish);
  let delivered = 0;
  for (const boat of fishing.boats) {
    boat.moving = false;
    if (boat.phase === 'outbound') {
      const fish = fishingFish(state, boat.target);
      if (!fish || fish.claimedBy !== boat.id) { releaseTarget(state, boat); boat.phase = boat.cargo ? 'returning' : 'idle'; }
      else if (distance(boat, fish) <= FISHING_CATCH_RADIUS && clearWaterSegment(state, nav, boat, fish)) {
        collectFish(state, nav, boat, fish);
      } else if (boat.path.length) {
        const last = boat.path.at(-1)!;
        if (cellAt(state.world, last) === cellAt(state.world, fish)) Object.assign(last, { x: fish.x, y: fish.y });
        else {
          releaseTarget(state, boat);
          const choice = chooseFish(state, nav, boat);
          if (choice !== true) boat.phase = choice === false && boat.cargo ? 'returning' : 'idle';
        }
      } else if (!boat.path.length && state.time >= boat.nextPlanAt) {
        releaseTarget(state, boat);
        const choice = chooseFish(state, nav, boat);
        if (choice !== true) boat.phase = choice === false && boat.cargo ? 'returning' : 'idle';
      }
    }
    if (boat.phase === 'returning') {
      if (distance(boat, boat.home) < .04) {
        const dock = entityStore(state).buildings.get(boat.dock), palace = entityStore(state).buildings.get(boat.city);
        const faction = state.factions.find(candidate => candidate.id === boat.faction);
        if (dock && palace && faction && dock.faction === boat.faction && palace.faction === boat.faction && buildingReady(dock) && buildingReady(palace)) {
          if (boat.cargo > 0) {
            grantIncome(faction, { food: boat.cargo }, state); palace.foodDelivered = (palace.foodDelivered ?? 0) + boat.cargo;
            state.particles.push({ x: dock.x + .5, y: dock.y + .5, text: `+${Math.round(boat.cargo)} food`, color: '#b9df85', life: 1.6, kind: 'food' });
            fishing.receipts.push({ city: palace.id, faction: faction.id, at: state.time, food: boat.cargo }); delivered += boat.cargo;
          }
          boat.cargo = 0; boat.firstCatchAt = undefined; boat.phase = 'idle'; boat.path = []; boat.nextPlanAt = state.time + .5;
        }
      } else if (!boat.path.length && state.time >= boat.nextPlanAt) { boat.path = returnPath(state, nav, boat); boat.nextPlanAt = state.time + 1; }
    }
    if (boat.phase === 'idle' && state.time >= boat.nextPlanAt) {
      const choice = chooseFish(state, nav, boat);
      if (choice === false && distance(boat, boat.home) >= .04) boat.phase = 'returning';
      if (choice !== undefined) boat.nextPlanAt = state.time + 1;
    }
    sailFishingBoat(state, nav, boat, dt);
    // Confirm net contact after sailing as well as before it. Fish can move
    // substantially between long simulation steps.
    if (boat.phase === 'outbound') {
      const fish = fishingFish(state, boat.target);
      if (fish?.claimedBy === boat.id && distance(boat, fish) <= FISHING_CATCH_RADIUS && clearWaterSegment(state, nav, boat, fish)) collectFish(state, nav, boat, fish);
    }
  }
  return delivered;
}

/** City growth and displayed food rates use actual delivered catch, smoothed
 * over three economy periods, never the size of unharvested natural stock. */
export function fishingCityFoodPerEconomyCycle(state: GameState, palaceId: number): number {
  const fishing = state.fishing; if (!fishing) return 0;
  const palace = entityStore(state).buildings.get(palaceId); if (!palace || !buildingReady(palace)) return 0;
  const elapsed = Math.max(ECONOMY_INTERVAL, Math.min(FISHING_INCOME_WINDOW, state.time - fishing.startedAt));
  return fishing.receipts.reduce((sum, receipt) => sum + (receipt.city === palaceId && receipt.faction === palace.faction
    && receipt.at > state.time - FISHING_INCOME_WINDOW ? receipt.food : 0), 0) * ECONOMY_INTERVAL / elapsed;
}
