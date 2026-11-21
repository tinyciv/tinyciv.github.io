import { entityStore } from './entity-store';
import { scenarioStructuresAllowed } from './scenario-access-native';
import { simRandom } from './sim-handle';
import { banditIntensity, banditPopulationCap, banditSpawnDeadline } from './bandit-intensity';
import { markWorldChanged } from './world-revisions';
import { constructionEdges } from './builders';
import { canMove, canWalk, hasStaticPathBetween, travelTimeMapFrom, wallBreachingNavigation, withNavigationFrame } from './pathfinding';
import { campCapacity, campNextSize, campParty, campPopulation, campTravelLimit, orderedCampSites, planCompactCamp, prepareCampSites } from './camp-sites-native';
import { terrainYields } from '../world/generator';
import { campLairCells, isBuildable, planCamp } from './warcamp-planner';
import { pointInSight, humanFogViews } from './fog';
import { pacifyRaidRegion, raidDirectorCancel, raidDirectorPacified } from './raid-director';
import { type Building, type CampSize, type GameState, type Point, type RaiderCamp, buildingReady, buildingSize, buildingHeight, distance, isFarmKind, isWallKind } from './types';

export const RAIDER_FACTION = -2;
export const RAIDER_COLOR = '#191b22';
export const RAIDER_CAMP_COLOR = '#8e6950';
export const RAIDER_WARNING_SECONDS = 10;
/** A burned camp's replacement appears after about seven minutes at normal intensity. */
export const RAIDER_CAMP_REBUILD_SECONDS = 420;
export const RAIDER_CAMP_RETRY_SECONDS = 30;
/** While a realm is pacified, replacement camps keep this far from its towns. */
export const PACIFIED_CAMP_DISTANCE = 40;
/** Budgets at 100% intensity, shared by every source including wilderness bands. */
export const MAX_LIVE_RAIDERS = 240;
export const MAX_LIVE_RAIDERS_PER_CAMP = 90;
const MAX_SITE_ATTEMPTS = 24;
const CAMP_SIZE_ORDER = ['large', 'small'] as const;
const NAMES = ['Scythians', 'Sarmatians', 'Cimmerians', 'Alans', 'Huns', 'Avars', 'Pechenegs', 'Cumans', 'Haiduks', 'Klephts'];
const styledRoadRevisions = new WeakMap<GameState, number>();

/** Camp tracks use the existing narrow dirt artwork while retaining real road
 * entities, which make the camp's stone gate work. Check existing camps on
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
  if (changed) markWorldChanged(state.world, 'appearance', []);
  return changed;
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
  return raiderCampActive(state, camp) ? banditPopulationCap(state, campCapacity(camp.size === 'small', raiderCampSupply(state, camp))) : 0;
}
export function raiderCampPartySize(state: GameState, camp: RaiderCamp, wanted: number): number {
  return raiderCampActive(state, camp) ? campParty(camp.size === 'small', raiderCampSupply(state, camp), wanted) : 0;
}
export function raiderCampRefuge(camp: RaiderCamp): Point {
  return camp.refuge ?? { x: camp.gate.x + .5, y: camp.gate.y + .5 };
}

/** A camp shows its warning while an announced raid gathers there. */
export function raiderCampWarning(state: GameState, camp: RaiderCamp): boolean {
  return !!camp.directedRaid && raiderCampActive(state, camp)
    && camp.nextRaidAt - state.time <= (camp.warningSeconds ?? RAIDER_WARNING_SECONDS) && state.time <= camp.nextRaidAt;
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
  const wanted = campPopulation(raiderPalaces(state).size);
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
    if (camp.directedRaid) { raidDirectorCancel(state, camp.directedRaid.faction, camp.directedRaid.total); delete camp.directedRaid; }
    // The realm that burned it earns quiet, distance and an announced vendetta.
    if (camp.lastAttacker !== undefined) pacifyRaidRegion(state, camp.lastAttacker);
    changed = true;
  }
  if (!banditIntensity(state)) return changed;
  const due = state.raiderCamps.filter(camp => camp.destroyed && camp.replacementAt !== undefined && camp.replacementAt <= state.time)
    .sort((a, b) => a.replacementAt! - b.replacementAt! || a.id - b.id);
  const retry = state.raiderCampPopulationRetryAt !== undefined && state.raiderCampPopulationRetryAt <= state.time;
  if (!due.length && !retry) return changed;
  const target = campPopulation(raiderPalaces(state).size);
  // Destroyed records reserve their own replacement slots. Only the explicit
  // initial-placement retry clock can fill an additional population vacancy.
  const missing = Math.max(0, target - state.raiderCamps.length);
  if (!missing) delete state.raiderCampPopulationRetryAt;
  const populationDue = retry ? missing : 0;
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

function raiderPalaces(state: GameState): Map<number, Building[]> {
  const realms = new Map<number, Building[]>();
  for (const palace of entityStore(state).buildings.query('palace')) {
    if (palace.faction < 0 || palace.hp <= 0 || !buildingReady(palace)) continue;
    let cities = realms.get(palace.faction);
    if (!cities) { cities = []; realms.set(palace.faction, cities); }
    cities.push(palace);
  }
  return realms;
}

function spawnRaiderCamps(state: GameState, wanted: number, hidden: boolean): number {
  const clearedCells: number[] = [];
  const realms = [...raiderPalaces(state)].sort(([a], [b]) => a - b);
  if (!realms.length) return 0;
  const { width, height } = state.world;
  // Keep the original capital locations reserved even if the cities move or fall.
  const starts = [...state.world.spawns, ...realms.map(([, [palace]]) => ({ x: palace.x + 1, y: palace.y + 1 }))];
  if (!hidden) for (const unit of state.units) if (unit.kind === 'leader' && unit.faction >= 0 && unit.hp > 0) starts.push(unit);
  const travelLimit = campTravelLimit();
  const planning = wallBreachingNavigation(state, { kind: 'raider' });
  const access = withNavigationFrame(planning, () => realms.map(([, palaces]) => {
    const exits = palaces.flatMap(palace => constructionEdges(planning, palace));
    return travelTimeMapFrom(planning, exits, RAIDER_FACTION, 2.35, travelLimit);
  }));
  const clearance = prepareCampSites(state, starts, access);
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
  // Realms that recently burned a camp keep replacements away from their newer towns, too.
  const keepAway = hidden ? realms.filter(([faction]) => raidDirectorPacified(state, faction))
    .flatMap(([, palaces]) => palaces.map(palace => ({ x: palace.x + 1, y: palace.y + 1 }))) : [];
  const outsideRespite = (point: Point): boolean => keepAway.every(origin => distance(point, origin) >= PACIFIED_CAMP_DISTANCE);
  for (let i = 0; i < clearance.length; i++) if (!clearance[i]) blocked.add(i);
  let spawned = 0, unavailable = 0, campId = 0;
  for (const camp of state.raiderCamps!) campId = Math.max(campId, camp.id);
  for (const building of state.buildings) campId = Math.max(campId, building.raiderCamp ?? 0);
  for (const pack of state.marauderPacks ?? []) campId = Math.max(campId, pack.raiderCamp ?? 0);
  let nextId = entityStore(state).peekId() - 1;
  while (spawned < wanted) {
    const active = state.raiderCamps!.filter(camp => raiderCampActive(state, camp));
    const large = active.filter(camp => camp.size === 'large').length;
    const small = active.filter(camp => camp.size === 'small').length;
    const sizeIndex = campNextSize(large, small, unavailable);
    const size: CampSize | undefined = CAMP_SIZE_ORDER[sizeIndex];
    if (!size) break;
    let placed = false;
    const groups = orderedCampSites(state, active.map(camp => camp.gate));
    // Prefer a site with a route to an underserved realm. Try the other
    // regions when terrain cannot fit the desired camp near that realm.
    search: for (const { realm, sites } of groups) {
      const travel = access[realm], palaces = realms[realm][1];
      const searched: Point[] = [];
      for (const cell of sites) {
        if (searched.length >= MAX_SITE_ATTEMPTS) break;
        const point = { x: cell % width, y: Math.floor(cell / width) };
        if (!outsideRespite(point) || !isBuildable(state.world, point.x, point.y, { blocked, preserveTrees: false })
          || searched.some(previous => distance(previous, point) < 5)
          || active.some(camp => distance(raiderCampCenter(camp), point) < 20)) continue;
        searched.push(point);
        const seed = Math.floor(simRandom(state) * 0x7fffffff);
        const options = { blocked, obstacles, access: travel, preserveTrees: false, size };
        const plan = size === 'small' ? planCompactCamp(state, point, seed, options) : planCamp(state.world, point, seed, options);
        if (!plan?.layout || !plan.bounds) continue;
        const { layout, bounds } = plan, center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        // The entire footprint must honor the start buffer. Avoid engulfing
        // a home, field or road even when buildings could fit around it.
        let clear = true;
        for (let y = bounds.y; y < bounds.y + bounds.height && clear; y++)
          for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
            const index = y * width + x;
            if (!clearance[index] || occupied.has(index)) { clear = false; break; }
          }
        if (!clear || !outsideRespite(center) || active.some(camp => distance(raiderCampCenter(camp), center) < 20)) continue;
        const { gate } = layout;
        if (!Number.isFinite(travel[gate.y * width + gate.x])) continue;
        const id = campId + 1, pending: Building[] = [], houses: number[] = [];
        const add = (kind: Building['kind'], x: number, y: number): Building => {
          const hp = kind === 'wall' ? 900 : kind === 'woodenTower' || kind === 'barbarianLair' ? 600 : kind === 'villageTent' ? 160 : 100;
          const building: Building = { id: nextId + pending.length + 1, kind, x, y, faction: RAIDER_FACTION, raiderCamp: id,
            hp, maxHp: hp, armor: kind === 'woodenTower' ? 6 : 2, capacity: 0 };
          pending.push(building); return building;
        };
        // Scenario entrances are open to every Leader. Ordinary worlds use
        // a faction-controlled gate in the stone wall.
        for (const p of layout.walls) add('wall', p.x, p.y);
        if (!state.world.scenario && size !== 'small') add('wall', gate.x, gate.y);
        const roads = new Map([...layout.paths, gate].map(p => [p.y * width + p.x, p]));
        for (const p of roads.values()) add('road', p.x, p.y).roadStyle = 'trail';
        const coreTowers: number[] = [];
        for (const p of layout.towers) { const tower = add('woodenTower', p.x, p.y); if (p.core) coreTowers.push(tower.id); }
        for (const p of layout.tents) houses.push(add('villageTent', p.x, p.y).id);
        if (layout.lair) add('barbarianLair', layout.lair.x, layout.lair.y);
        if (!scenarioStructuresAllowed(state,pending)) continue;
        // Local access can lead into a peninsula whose only exit the camp itself
        // closes. Probe the complete proposed structures before committing them,
        // and preserve the routes of camps already placed during this search.
        const proposed = { ...state, buildings: [...state.buildings.filter(building => !(isWallKind(building.kind) && building.faction >= 0)), ...pending] };
        const routePreserved = withNavigationFrame(proposed, () => {
          const exits = palaces.flatMap(palace => constructionEdges(proposed, palace));
          const connected = travelTimeMapFrom(proposed, exits, RAIDER_FACTION, 2.35, travelLimit);
          if (!Number.isFinite(connected[gate.y * width + gate.x])) return false;
          return realms.every(([, cities], index) => {
            const origins = index === realm ? exits : cities.flatMap(city => constructionEdges(proposed, city));
            return active.every(camp => !Number.isFinite(access[index][camp.gate.y * width + camp.gate.x])
              || hasStaticPathBetween(proposed, origins, [{ x: camp.gate.x + .5, y: camp.gate.y + .5 }], RAIDER_FACTION));
          });
        });
        if (!routePreserved) continue;
        campId = id; nextId += pending.length;
        const camp: RaiderCamp = { id, name: NAMES[Math.floor(simRandom(state) * NAMES.length)], size, ...bounds,
          gate,
          signs: layout.signs.map(({ x, y }) => ({ x, y })), houses, coreTowers,
          refuge: { x: layout.refuge.x + .5, y: layout.refuge.y + .5 }, tentCapacity: houses.length,
          // Idle until the raid director announces a raid here.
          nextRaidAt: Number.MAX_SAFE_INTEGER, waves: 0 };
        entityStore(state).buildings.add(...pending);
        // Clear only accepted construction cells. The surrounding woodland, water,
        // elevation, cliff edges and natural stair connections are preserved.
        for (const p of [...layout.walls, gate, ...layout.tents, ...layout.towers, ...(layout.lair ? campLairCells(layout.lair) : []), ...layout.paths, ...layout.signs]) {
          const tile = state.world.tiles[p.y * width + p.x];
          if (tile.overlay !== 'forest' && tile.overlay !== 'jungle') continue;
          const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields(tile.terrain, 'none');
          tile.overlay = 'none'; clearedCells.push(p.y * width + p.x);
          for (const resource of ['food', 'production', 'gold'] as const)
            tile[resource] = Math.max(0, tile[resource] - before[resource] + after[resource]);
        }
        // Commit only complete plans. Reserve them before considering the next camp.
        for (const building of pending) reserve(building);
        for (const sign of camp.signs!) blocked.add(sign.y * width + sign.x);
        state.raiderCamps!.push(camp); spawned++; placed = true;
        break search;
      }
    }
    if (!placed) unavailable |= 1 << sizeIndex;
  }
  if (spawned) markWorldChanged(state.world, 'sight', clearedCells);
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
