import { entityStore } from './entity-store';
import { banditIntensity, banditPopulationCap, banditSpawnDeadline } from './bandit-intensity';
import { markWorldChanged } from './world-revisions';
import { constructionEdges } from './builders';
import { canMove, canWalk, travelTimeMap, travelTimeMapFrom } from './pathfinding';
import { terrainYields } from '../world/generator';
import { isBuildable, planCamp } from './warcamp-planner';
import { pointInSight, humanFogViews } from './fog';
import { RAIDER_OPENING_WAVE_INTERVAL } from './raider-pressure';
import { type Building, type CampSize, type GameState, type Point, type RaiderCamp, buildingReady, buildingSize, buildingHeight, distance, isFarmKind, isWallKind } from './types';

export const RAIDER_FACTION = -2;
export const RAIDER_COLOR = '#191b22';
export const RAIDER_CAMP_COLOR = '#8e6950';
export const RAIDER_FIRST_WAVE = 60;
export const RAIDER_WAVE_INTERVAL = RAIDER_OPENING_WAVE_INTERVAL;
export const RAIDER_WARNING_SECONDS = 10;
export const RAIDER_CAMP_REBUILD_SECONDS = 120;
export const RAIDER_CAMP_RETRY_SECONDS = 30;
/** Budgets at 100% intensity, shared by every source including wilderness bands. */
export const MAX_LIVE_RAIDERS = 240;
export const MAX_LIVE_RAIDERS_PER_CAMP = 90;
const MAX_SITE_ATTEMPTS = 48;
// Fit the most demanding footprint first when the population is balanced.
const CAMP_SIZE_ORDER: readonly CampSize[] = ['large', 'medium', 'small'];
const NAMES = ['Scythians', 'Sarmatians', 'Cimmerians', 'Alans', 'Huns', 'Avars', 'Pechenegs', 'Cumans', 'Haiduks', 'Klephts'];
const styledRoadRevisions = new WeakMap<GameState, number>();

/** Camp tracks use the existing narrow dirt artwork while retaining real road
 * entities, which make the camp's palisade gates work. Check existing camps on
 * initialization or a building change, rather than scanning every frame. */
function refreshCampRoadStyles(state: GameState): boolean {
  const revision = entityStore(state).buildings.revision;
  if (styledRoadRevisions.get(state) === revision) return false;
  styledRoadRevisions.set(state, revision);
  let changed = false;
  for (const building of state.buildings) if (building.kind === 'road' && building.faction === RAIDER_FACTION
    && building.raiderCamp !== undefined && building.roadStyle !== 'trail') {
    building.roadStyle = 'trail'; changed = true;
  }
  if (changed) markWorldChanged(state.world, 'appearance');
  return changed;
}

function random(state: GameState): number {
  let value = state.rngState += 0x6D2B79F5;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  state.rngState >>>= 0;
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
}

export const raiderCampCenter = (camp: RaiderCamp): Point => ({ x: camp.x + camp.width / 2, y: camp.y + camp.height / 2 });
export function raiderCampActive(state: GameState, camp: RaiderCamp): boolean {
  const buildings = entityStore(state).buildings;
  return !camp.destroyed && (camp.coreTowers ?? []).some(id => { const tower = buildings.get(id); return !!tower && tower.hp > 0 && tower.faction === RAIDER_FACTION; });
}
/** Destroying tents removes recruitment capacity without bypassing the keep.
 * An intact core without tents supports at most five active/reserve raiders. */
export function raiderCampSupply(state: GameState, camp: RaiderCamp): number {
  if (!raiderCampActive(state, camp)) return 0;
  const buildings = entityStore(state).buildings;
  const remaining = camp.houses.filter(id => { const tent = buildings.get(id); return !!tent && tent.hp > 0 && tent.faction === RAIDER_FACTION; }).length;
  return Math.min(1, remaining / Math.max(1, camp.tentCapacity ?? camp.houses.length));
}
export function raiderCampPopulationCap(state: GameState, camp: RaiderCamp): number {
  return raiderCampActive(state, camp) ? banditPopulationCap(state, Math.round(5 + (MAX_LIVE_RAIDERS_PER_CAMP - 5) * raiderCampSupply(state, camp))) : 0;
}
export function raiderCampPartySize(state: GameState, camp: RaiderCamp, wanted: number): number {
  return raiderCampActive(state, camp) ? Math.max(1, Math.min(wanted, Math.round(1 + (wanted - 1) * raiderCampSupply(state, camp)))) : 0;
}
export function raiderCampRefuge(camp: RaiderCamp): Point {
  return camp.refuge ?? { x: camp.gate.x + .5, y: camp.gate.y + .5 };
}

export function raiderCampWarning(state: GameState, camp: RaiderCamp): boolean {
  return banditIntensity(state) > 0 && raiderCampActive(state, camp) && camp.nextRaidAt - state.time <= RAIDER_WARNING_SECONDS && state.time <= camp.nextRaidAt;
}

/** Establish the initial population once. Unfilled slots and destroyed camps
 * have explicit retry clocks; an empty initialized list never restarts it. */
export function initializeRaiderCamps(state: GameState): void {
  refreshCampRoadStyles(state);
  if (state.raiderCamps !== undefined) return;
  state.raiderCamps = [];
  // Replace obsolete arbitrary fog raids, preserving independent wilderness
  // bands. Old scheduled approaches become ordinary local wandering.
  state.marauderPacks = (state.marauderPacks ?? []).filter(pack => !pack.raid || pack.raiderCamp !== undefined);
  for (const pack of state.marauderPacks) if (!pack.raid) { delete pack.approachAt; pack.color = RAIDER_COLOR; }
  const retained = new Set(state.marauderPacks.map(pack => pack.id));
  entityStore(state).units.retain(unit => unit.marauderPack === undefined || retained.has(unit.marauderPack));
  const wanted = state.world.width * state.world.height >= 10000 ? 3 : 2;
  if (spawnRaiderCamps(state, wanted, false) < wanted)
    state.raiderCampPopulationRetryAt = banditSpawnDeadline(state, RAIDER_CAMP_RETRY_SECONDS);
}

/** One destroyed camp is replaced by one hidden camp after a respite. Missing
 * safe land defers the attempt; it never permits a visible or disconnected camp. */
export function updateRaiderCamps(state: GameState): boolean {
  if (!state.raiderCamps) return false;
  let changed = refreshCampRoadStyles(state);
  for (const camp of state.raiderCamps) if (!raiderCampActive(state, camp) && camp.replacementAt === undefined) {
    camp.destroyed = true;
    camp.replacementAt = banditSpawnDeadline(state, RAIDER_CAMP_REBUILD_SECONDS);
    changed = true;
  }
  if (!banditIntensity(state)) return changed;
  const due = state.raiderCamps.filter(camp => camp.destroyed && camp.replacementAt !== undefined && camp.replacementAt <= state.time)
    .sort((a, b) => a.replacementAt! - b.replacementAt! || a.id - b.id);
  const target = state.world.width * state.world.height >= 10000 ? 3 : 2;
  // Destroyed records reserve their own replacement slots. Only the explicit
  // initial-placement retry clock can fill an additional population vacancy.
  const missing = Math.max(0, target - state.raiderCamps.length);
  const populationDue = missing && state.raiderCampPopulationRetryAt !== undefined
    && state.raiderCampPopulationRetryAt <= state.time ? missing : 0;
  if (!due.length && !populationDue) return changed;
  const added = spawnRaiderCamps(state, due.length + populationDue, true);
  const replaced = Math.min(added, due.length);
  const retired = new Set(due.slice(0, replaced).map(camp => camp.id));
  state.raiderCamps = state.raiderCamps.filter(camp => !retired.has(camp.id));
  for (const camp of due.slice(replaced)) camp.replacementAt = banditSpawnDeadline(state, RAIDER_CAMP_RETRY_SECONDS);
  if (state.raiderCampPopulationRetryAt !== undefined) {
    if (state.raiderCamps.length >= target) delete state.raiderCampPopulationRetryAt;
    else if (populationDue) state.raiderCampPopulationRetryAt = banditSpawnDeadline(state, RAIDER_CAMP_RETRY_SECONDS);
  }
  return true;
}

function spawnRaiderCamps(state: GameState, wanted: number, hidden: boolean): number {
  const palaces = state.buildings.filter(building => building.kind === 'palace' && building.faction >= 0 && buildingReady(building));
  if (!palaces.length) return 0;
  const { width, height } = state.world;
  const sizeOrder: readonly CampSize[] = width * height >= 10000 ? CAMP_SIZE_ORDER : ['medium', 'small'];
  const planning = { ...state, buildings: state.buildings.filter(building => !(isWallKind(building.kind) && building.faction >= 0)) };
  const access = palaces.flatMap(palace => {
    const exit = constructionEdges(planning, palace)[0];
    return exit ? [travelTimeMap(planning, exit, RAIDER_FACTION, 2.35, 100)] : [];
  });
  if (!access.length) return 0;
  const travel = new Float64Array(width * height);
  for (let i = 0; i < travel.length; i++) travel[i] = Math.min(...access.map(map => map[i]));
  const blocked = new Set<number>(), obstacles = new Set<number>(), occupied = new Set<number>();
  const reserve = (building: Building): void => {
    const margin = isFarmKind(building.kind) ? 2 : 1, size = buildingSize(building);
    for (let y = Math.max(0, building.y - margin); y < Math.min(height, building.y + buildingHeight(building) + margin); y++)
      for (let x = Math.max(0, building.x - margin); x < Math.min(width, building.x + size + margin); x++) blocked.add(y * width + x);
    for (let y = building.y; y < building.y + buildingHeight(building); y++)
      for (let x = building.x; x < building.x + size; x++) occupied.add(y * width + x);
    if (!isFarmKind(building.kind) && !['road', 'bridge', 'irrigation', 'ruin'].includes(building.kind))
      for (let y = building.y; y < building.y + buildingHeight(building); y++)
        for (let x = building.x; x < building.x + size; x++) obstacles.add(y * width + x);
  };
  for (const building of state.buildings) if (building.hp > 0) reserve(building);
  for (const field of state.fields ?? []) { blocked.add(field.y * width + field.x); occupied.add(field.y * width + field.x); }
  // Reserve the actual construction footprint around live players, not merely
  // the center of a much larger camp. Hidden replacements reserve sight too.
  for (const unit of state.units) if (unit.hp > 0 && unit.faction >= 0) {
    for (let y = Math.max(0, Math.floor(unit.y - 12)); y < Math.min(height, unit.y + 12); y++)
      for (let x = Math.max(0, Math.floor(unit.x - 12)); x < Math.min(width, unit.x + 12); x++)
        if (Math.hypot(x + .5 - unit.x, y + .5 - unit.y) < 12) blocked.add(y * width + x);
  }
  const views = hidden ? humanFogViews(state) : [];
  if (views.length) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    if (views.some(fog => pointInSight(fog, x + .5, y + .5))) blocked.add(y * width + x);
  const origins = palaces.map(palace => ({ x: palace.x + 1, y: palace.y + 1 }));
  const candidates: { point: Point; score: number; seed: number }[] = [];
  // A sparse strategic pass feeds the bounded local shape search. It no longer
  // demands a rectangular clearing or flattens the chosen terrain.
  for (let y = 12; y < height - 12; y += 3) for (let x = 12; x < width - 12; x += 3) {
    const point = { x, y }, d = Math.min(...origins.map(origin => distance(point, origin))), cell = y * width + x;
    if (d < 21 || d > 65 || !Number.isFinite(travel[cell]) || blocked.has(cell)
      || !isBuildable(state.world, x, y, { preserveTrees: false })) continue;
    const jitter = random(state);
    candidates.push({ point, score: Math.abs(d - 32) + Math.abs(travel[cell] - 20) * .35 + jitter * 3,
      seed: Math.floor(jitter * 0x7fffffff) });
  }
  candidates.sort((a, b) => a.score - b.score || a.point.y - b.point.y || a.point.x - b.point.x);
  let spawned = 0;
  const failedSizes = new Set<CampSize>();
  let campId = Math.max(0, ...state.raiderCamps!.map(camp => camp.id),
    ...state.buildings.map(building => building.raiderCamp ?? 0), ...(state.marauderPacks ?? []).map(pack => pack.raiderCamp ?? 0));
  let nextId = Math.max(0, ...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id));
  while (spawned < wanted) {
    const counts: Record<CampSize, number> = { small: 0, medium: 0, large: 0 };
    for (const camp of state.raiderCamps!) if (raiderCampActive(state, camp)) counts[camp.size]++;
    const least = Math.min(...sizeOrder.map(size => counts[size]));
    const size = sizeOrder.find(size => counts[size] === least && !failedSizes.has(size));
    // Exhausting a class never turns its slot into another oversized camp.
    // Replacements retry a missing class when suitable hidden land opens up.
    if (!size) break;
    let placed = false, attempts = 0;
    const searched: Point[] = [];
    for (const candidate of candidates) {
      if (attempts >= MAX_SITE_ATTEMPTS) break;
      if (searched.some(point => distance(point, candidate.point) < 5)
        || state.raiderCamps!.some(camp => !camp.destroyed && distance(raiderCampCenter(camp), candidate.point) < 20)) continue;
      searched.push(candidate.point); attempts++;
      const plan = planCamp(state.world, candidate.point, candidate.seed, { blocked, obstacles, access: travel, preserveTrees: false, size });
      if (!plan.layout || !plan.bounds || !plan.checks.valid) continue;
      const { layout, bounds } = plan, center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      // Do not surround somebody else's existing home, field, or road even when
      // the new wall and tent cells themselves happen not to overlap it.
      let enclosesExisting = false;
      for (let y = bounds.y; y < bounds.y + bounds.height && !enclosesExisting; y++)
        for (let x = bounds.x; x < bounds.x + bounds.width; x++) if (occupied.has(y * width + x)) { enclosesExisting = true; break; }
      if (enclosesExisting) continue;
      const d = Math.min(...origins.map(origin => distance(center, origin)));
      if (d < 21 || d > 65 || state.raiderCamps!.some(camp => !camp.destroyed && distance(raiderCampCenter(camp), center) < 20)) continue;
      const gate = layout.gates[0];
      if (!gate || !Number.isFinite(travel[gate.y * width + gate.x])) continue;
      const id = campId + 1, pending: Building[] = [], houses: number[] = [];
      const add = (kind: Building['kind'], x: number, y: number): Building => {
        const hp = kind === 'wall' ? 900 : isWallKind(kind) ? 225 : kind === 'woodenTower' ? 600 : kind === 'villageTent' ? 160 : 100;
        const building: Building = { id: nextId + pending.length + 1, kind, x, y, faction: RAIDER_FACTION, raiderCamp: id,
          hp, maxHp: hp, armor: kind === 'woodenTower' ? 6 : 2, capacity: 0 };
        pending.push(building); return building;
      };
      // Narrow dirt roads layered onto palisades retain faction-controlled gates.
      for (const p of [...layout.walls, ...layout.gates]) add(p.tier === 1 ? 'wall' : 'palisade', p.x, p.y);
      const roads = new Map([...layout.paths, ...layout.gates].map(p => [p.y * width + p.x, p]));
      for (const p of roads.values()) add('road', p.x, p.y).roadStyle = 'trail';
      const coreTowers: number[] = [];
      for (const p of layout.towers) { const tower = add('woodenTower', p.x, p.y); if (p.tier === 1) coreTowers.push(tower.id); }
      for (const p of layout.tents) houses.push(add('villageTent', p.x, p.y).id);
      // Local access can lead into a peninsula whose only exit the camp itself
      // closes. Probe the complete proposed structures before committing them,
      // and preserve the routes of camps already placed during this search.
      const proposed = { ...state, buildings: [...state.buildings.filter(building => !(isWallKind(building.kind) && building.faction >= 0)), ...pending] };
      const exits = palaces.flatMap(palace => constructionEdges(proposed, palace));
      const connected = travelTimeMapFrom(proposed, exits, RAIDER_FACTION, 2.35, 100);
      const gates = [gate, ...state.raiderCamps!.filter(camp => raiderCampActive(state, camp)
        && Number.isFinite(travel[camp.gate.y * width + camp.gate.x])).map(camp => camp.gate)];
      if (gates.some(point => !Number.isFinite(connected[point.y * width + point.x]))) continue;
      campId = id; nextId += pending.length;
      const camp: RaiderCamp = { id, name: NAMES[Math.floor(random(state) * NAMES.length)], size, ...bounds,
        gate: { x: gate.x, y: gate.y }, gates: layout.gates.map(({ x, y }) => ({ x, y })),
        signs: layout.signs.map(({ x, y }) => ({ x, y })), houses, coreTowers,
        refuge: { x: layout.refuge.x + .5, y: layout.refuge.y + .5 }, tentCapacity: houses.length,
        nextRaidAt: banditSpawnDeadline(state, RAIDER_FIRST_WAVE + spawned * RAIDER_WAVE_INTERVAL), waves: 0 };
      entityStore(state).buildings.add(...pending);
      // Clear only accepted construction cells. The surrounding woodland, water,
      // elevation, cliff edges and natural stair connections are preserved.
      for (const p of [...layout.walls, ...layout.gates, ...layout.tents, ...layout.towers, ...layout.paths, ...layout.signs]) {
        const tile = state.world.tiles[p.y * width + p.x];
        if (tile.overlay !== 'forest' && tile.overlay !== 'jungle') continue;
        const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields(tile.terrain, 'none');
        tile.overlay = 'none';
        for (const resource of ['food', 'production', 'gold'] as const)
          tile[resource] = Math.max(0, tile[resource] - before[resource] + after[resource]);
      }
      // Commit only complete plans. Reserve them before considering the next camp.
      for (const building of state.buildings) if (building.raiderCamp === id) reserve(building);
      for (const sign of camp.signs!) blocked.add(sign.y * width + sign.x);
      state.raiderCamps!.push(camp); spawned++; placed = true;
      break;
    }
    if (!placed) failedSizes.add(size);
  }
  if (spawned) markWorldChanged(state.world, 'sight');
  return spawned;
}

/** Camp-centered spawn cells are real traversable ground. Raids can be witnessed
 * at known camps; unlike arbitrary fog spawns they never materialize elsewhere. */
export function campSpawnTiles(state: GameState, camp: RaiderCamp, count: number): Point[] {
  const center = raiderCampCenter(camp), { width, height } = state.world;
  const occupied = new Set(state.units.filter(unit => unit.hp > 0 && !unit.inside).map(unit => Math.floor(unit.y) * width + Math.floor(unit.x)));
  const fields = new Set((state.fields ?? []).map(field => field.y * width + field.x));
  const defended = new Set<number>();
  for (const unit of state.units) if (unit.hp > 0 && !unit.inside && unit.faction !== RAIDER_FACTION) {
    for (let y = Math.floor(unit.y) - 2; y <= Math.floor(unit.y) + 2; y++) for (let x = Math.floor(unit.x) - 2; x <= Math.floor(unit.x) + 2; x++)
      if (x >= 0 && y >= 0 && x < width && y < height && distance(unit, { x: x + .5, y: y + .5 }) < 1.5) defended.add(y * width + x);
  }
  // Grow the muster area with the wave instead of silently stopping late raids
  // once a fixed 11×11 camp footprint can no longer hold their soldiers. Flood
  // from the real gate so water and inaccessible upper ledges cannot receive
  // disconnected reinforcements.
  const start = { x: camp.gate.x + .5, y: camp.gate.y + .5 };
  if (!canWalk(state, start.x, start.y, RAIDER_FACTION)) return [];
  const points: Point[] = [], queue: Point[] = [start], visited = new Set([camp.gate.y * width + camp.gate.x]);
  const reach = Math.max(9, Math.ceil(Math.max(camp.width, camp.height) / 2) + 3, Math.ceil(Math.sqrt(Math.max(0, count))) + 4);
  const steps = [[0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let head = 0; head < queue.length && points.length < count; head++) {
    const point = queue[head], x = Math.floor(point.x), y = Math.floor(point.y), key = y * width + x;
    if (!occupied.has(key) && !fields.has(key) && !defended.has(key)) points.push(point);
    for (const [dx, dy] of steps) {
      const next = { x: point.x + dx, y: point.y + dy }, nx = x + dx, ny = y + dy, index = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || visited.has(index) || distance(next, center) > reach) continue;
      if (canMove(state, point, next, RAIDER_FACTION)) { visited.add(index); queue.push(next); }
    }
  }
  // Gather near the gate, then spread into the connected camp surroundings.
  return points.sort((a, b) => distance(a, camp.gate) - distance(b, camp.gate) || distance(a, center) - distance(b, center)).slice(0, count);
}
