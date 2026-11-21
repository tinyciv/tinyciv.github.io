import { forbiddenRevision, isForbidden } from './forbidden-zones';
import { type Building, type BuildingKind, type GameState, type Point, buildingPresent, buildingReady, buildingWidth, buildingHeight, isFarmKind, isWallKind, tileAt } from './types';
import { CAMP_FIELD_OFFSETS, invalidateScheduledHarvests, synchronizeFarms } from './farms';
import { terrainYields } from '../world/generator';
import { markWorldChanged, recordWorldTileChanges } from './world-revisions';
import { constructionEdges } from './builders';
import { createReachabilityQuery, invalidateNavigation, traversable, withNavigationFrame } from './pathfinding';
import { palaceReachability } from './placement';
import { reliefFootprintAllowed } from './relief';
import { farmCityQuery, farmWalkingDistance, palaceWalkingDistances } from './farm-travel';
import { buildingWithinBorders } from './border-placement';
import { territory } from './borders';
import { farmCompactnessExclusions, farmCompactnessQuery, FARM_CLUSTER_WALKING_BIAS } from './farm-clusters';
import { farmBlockPlacementQuery, farmBlockRemovalQueries, type FarmBlockQuery } from './farm-blocks';
import TinyQueue from 'tinyqueue';
import { entityStore } from './entity-store';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';
import { orderedDistanceCells } from './ordered-distance-cells';
import { overlapsFallenDefense } from './defense-rebuilding';
import { farmCanShareTile } from './placement-occupancy';

export interface FarmRelocationPlan { camp: number; palace: number; from: Point; to: Point; }
export interface FarmRelocationOptions {
  /** Walls retain a usable nearby plot; only housing redevelopment must move outward. */
  wall?: boolean;
  /** A new road reserves crop space but remains open to the replacement courier. */
  road?: boolean;
  /** Other solid buildings may move crops nearby without granting housing bonuses. */
  nearby?: boolean;
  /** Relocate unfinished orders while preserving their paid work and builder. */
  unfinished?: boolean;
  /** Reserve the complete drag, including cells that have not been ordered yet. */
  reservedTiles?: ReadonlySet<number>;
  /** Other replacement crops occupy space but remain walkable. */
  reservedPlots?: ReadonlySet<number>;
  /** Sources all moved by this same atomic batch, unlike a partially valid stroke. */
  removedFarmCells?: ReadonlySet<number>;
  /** Commit checks only this quoted plot, rather than searching the whole map again. */
  destination?: Point;
}
const CLEARABLE = new Set(['none', 'forest', 'jungle', 'swamp']);
const distanceSquared = (a: Point, b: Point): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
interface RelocationCandidate { point: Point; distance: number; walking: number; score: number }

interface RelocationSetup {
  occupied: (cell: number) => boolean; farmCity: ReturnType<typeof farmCityQuery>; walking: ReturnType<typeof palaceWalkingDistances>;
  compactness: (x: number, y: number) => number; geometry: FarmBlockQuery; borders: ReturnType<typeof territory> | undefined;
  /** Solid pending construction, excluding the house cell supplied per probe. */
  reserved: (cell: number) => boolean; gates: ReadonlySet<number>;
}
interface SharedRelocation {
  occupied: Set<number>; farmCity: ReturnType<typeof farmCityQuery>; walking: ReturnType<typeof palaceWalkingDistances>;
  compactness: ReturnType<typeof farmCompactnessExclusions>; geometry: ReturnType<typeof farmBlockRemovalQueries>;
  borders: ReturnType<typeof territory> | undefined; reserved: Set<number>; gates: Set<number>;
}
const relocationProbes = new WeakMap<GameState, Map<string, SharedRelocation>>();

/** A read-only pass that probes many farms for one city (house siting) shares
 * the occupancy, crop-block, compactness and ownership indexes instead of
 * rebuilding them from every building and field per probe. The state must not
 * change inside `run`; plans are identical to unbatched calls. */
export function withFarmRelocationProbes<T>(state: GameState, run: () => T): T {
  if (relocationProbes.has(state)) return run();
  relocationProbes.set(state, new Map());
  try { return run(); } finally { relocationProbes.delete(state); }
}

function constructionReservations(state: GameState, faction: number, gates: ReadonlySet<number>, reserved: Set<number>): void {
  const { width } = state.world;
  for (const building of state.buildings) if (building.hp > 0 && building.construction && !isFarmKind(building.kind)
    && !['road', 'bridge', 'irrigation', 'ruin'].includes(building.kind)) {
    for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++) {
      const cell = (building.y + dy) * width + building.x + dx;
      if (!(isWallKind(building.kind) && building.faction === faction && gates.has(cell))) reserved.add(cell);
    }
  }
}
function friendlyGates(state: GameState, faction: number): Set<number> {
  const { width } = state.world;
  return new Set(state.buildings.filter(building => building.hp > 0 && building.kind === 'road'
    && (building.faction === faction || building.faction === -1)).map(building => building.y * width + building.x));
}
function occupiedCells(state: GameState, faction: number): Set<number> {
  const { width } = state.world, occupied = new Set<number>();
  for (const building of state.buildings) if ((building.hp > 0 || building.kind === 'fort' && building.fort?.destroyed)
    && !farmCanShareTile(building, faction)) {
    for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++)
      occupied.add((building.y + dy) * width + building.x + dx);
  }
  for (const field of state.fields ?? []) occupied.add(field.y * width + field.x);
  return occupied;
}
const defaultOptions = (options: FarmRelocationOptions): boolean => Object.values(options).every(value => value === undefined);

function relocationSetup(state: GameState, palace: Building, camp: Building, house: Point, options: FarmRelocationOptions): RelocationSetup {
  const { width } = state.world, houseCell = house.y * width + house.x, campCell = camp.y * width + camp.x;
  const batch = defaultOptions(options) ? relocationProbes.get(state) : undefined;
  if (batch) {
    const key = `${palace.id}:${camp.faction}`;
    let shared = batch.get(key);
    if (!shared) {
      const gates = friendlyGates(state, camp.faction), reserved = new Set<number>();
      constructionReservations(state, camp.faction, gates, reserved);
      shared = { occupied: occupiedCells(state, camp.faction), farmCity: farmCityQuery(state, camp.faction),
        walking: palaceWalkingDistances(state, palace), compactness: farmCompactnessExclusions(state, camp.faction),
        geometry: farmBlockRemovalQueries(state), borders: state.villages?.length ? territory(state) : undefined, reserved, gates };
      batch.set(key, shared);
    }
    const { occupied, reserved } = shared;
    return { occupied: cell => cell === houseCell || occupied.has(cell), farmCity: shared.farmCity, walking: shared.walking,
      compactness: shared.compactness(camp), geometry: shared.geometry(campCell), borders: shared.borders,
      reserved: cell => cell === houseCell || reserved.has(cell), gates: shared.gates };
  }
  const occupied = occupiedCells(state, camp.faction);
  // Moving a whole farm to a disjoint footprint keeps all former cells free.
  occupied.add(houseCell);
  for (const cell of options.reservedTiles ?? []) occupied.add(cell);
  for (const cell of options.reservedPlots ?? []) occupied.add(cell);
  const removedCells = new Set(options.removedFarmCells); removedCells.add(campCell);
  const gates = friendlyGates(state, camp.faction);
  const reserved = new Set(options.road ? [] : options.reservedTiles ?? []);
  if (!options.road) reserved.add(houseCell);
  // Pending solid footprints must remain passable after construction, too.
  // A friendly road under a wall is a gate and preserves farmer access.
  if (options.wall) for (const cell of gates) reserved.delete(cell);
  constructionReservations(state, camp.faction, gates, reserved);
  return { occupied: cell => occupied.has(cell), farmCity: farmCityQuery(state, camp.faction), walking: palaceWalkingDistances(state, palace),
    compactness: farmCompactnessQuery(state, camp.faction, { excludeCamp: camp.id, vacatedCells: options.reservedTiles, plannedCells: options.reservedPlots }),
    geometry: farmBlockPlacementQuery(state, { removedCells, addedCells: options.reservedPlots }),
    borders: state.villages?.length ? territory(state) : undefined, reserved: cell => reserved.has(cell), gates };
}

/** Find a replacement crop tile before touching the existing farm. Farms
 * may move outside borders, but stay with this city and cannot cover roads. */
export function planFarmRelocation(state: GameState, palace: Building, camp: Building, house: Point,
  reachable = palaceReachability(state, palace), options: FarmRelocationOptions = {}): FarmRelocationPlan | undefined {
  if (!buildingReady(palace) || camp.hp <= 0 || !buildingReady(camp) && !options.road && !options.unfinished
    || !isFarmKind(camp.kind) || camp.faction !== palace.faction || camp.farmSuppressed) return;
  const { width } = state.world;
  const { occupied, farmCity, walking, compactness, geometry, borders, reserved } = relocationSetup(state, palace, camp, house, options);
  const oldDistance = distanceSquared(camp, palace);
  const target = options.destination;
  function* candidates(): Generator<RelocationCandidate> {
    const queue = new TinyQueue<RelocationCandidate>([], (a, b) => a.score - b.score || a.walking - b.walking
      || a.distance - b.distance || a.point.y - b.point.y || a.point.x - b.point.x);
    // Compactness can improve a score by at most 1.5 walking tiles. Stream
    // candidates in exactly the previous order, stopping as soon as one fits;
    // a distant cell cannot outrank a nearer queued candidate beyond that band.
    const cells = target ? [target.y * width + target.x] : orderedDistanceCells(walking);
    for (const cell of cells) {
      while (queue.length && walking[cell] - FARM_CLUSTER_WALKING_BIAS > queue.peek()!.score) yield queue.pop()!;
      if (!reachable[cell] || occupied(cell)) continue;
      const point = { x: cell % width, y: Math.floor(cell / width) }, d = distanceSquared(point, palace);
      if (!options.wall && !options.nearby && d <= oldDistance) continue;
      const travel = farmWalkingDistance(walking, width, point.x, point.y);
      queue.push({ point, distance: d, walking: travel, score: travel - compactness(point.x, point.y) * FARM_CLUSTER_WALKING_BIAS });
    }
    while (queue.length) yield queue.pop()!;
  }
  return withNavigationFrame(state, () => {
    const blocked = { has: reserved };
    // Flood fills from each construction exit are only needed by a candidate
    // that passes every cheaper test, so build them on first use.
    let access: ((point: Point) => boolean)[] | undefined;
    const reachableFromCity = (point: Point): boolean => (access ??= constructionEdges(state, palace, true)
      .filter(exit => !blocked.has(Math.floor(exit.y) * width + Math.floor(exit.x)))
      .map(exit => createReachabilityQuery(state, exit, palace.faction, blocked, true))).some(query => query(point));
    for (const { point } of candidates()) {
      // Test detailed ledge geometry after ordering nearby candidates. Scanning
      // every distant ledge apron dominated large-map drag previews.
      if (farmCity(point)?.id !== palace.id || !CAMP_FIELD_OFFSETS.every(([dx, dy]) => {
        const px = point.x + dx, py = point.y + dy, tile = tileAt(state.world, px, py);
        return !isForbidden(state, px, py, camp.faction) && !occupied(py * width + px) && !overlapsFallenDefense(state, camp.kind, px, py)
          && !!tile && tile.farm === undefined && CLEARABLE.has(tile.overlay)
          && traversable(state.world, px, py) && !!reachable[py * width + px];
      }) || !buildingWithinBorders(state, camp.kind, point.x, point.y, camp.faction, borders)
        || !reliefFootprintAllowed(state.world, point.x, point.y, 1) || !geometry.canAdd(point).ok) continue;
      if (!CAMP_FIELD_OFFSETS.every(([dx, dy]) => reachableFromCity({ x: point.x + dx + .5, y: point.y + dy + .5 }))) continue;
      return { camp: camp.id, palace: palace.id, from: { x: camp.x, y: camp.y }, to: point };
    }
  });
}

export function farmAt(state: GameState, point: Point, faction: number): Building | undefined {
  return state.buildings.find(building => building.hp > 0 && isFarmKind(building.kind) && building.faction === faction
    && point.x >= building.x && point.y >= building.y && point.x < building.x + buildingWidth(building)
    && point.y < building.y + buildingHeight(building));
}

/** Houses retain outward redevelopment; roads and walls have their own gate/stroke rules. */
export function buildingDisplacesFarms(kind: BuildingKind): boolean {
  return !isFarmKind(kind) && !isWallKind(kind) && !['house', 'road', 'bridge', 'irrigation', 'ruin'].includes(kind);
}
export interface BuildingFarmRelocations {
  kind: BuildingKind;
  faction: number;
  point: Point;
  farms: FarmRelocationPlan[];
}
function buildingFootprint(state: GameState, kind: BuildingKind, point: Point): Set<number> {
  const cells = new Set<number>();
  for (let dy = 0; dy < buildingHeight({ kind }); dy++) for (let dx = 0; dx < buildingWidth({ kind }); dx++)
    cells.add((point.y + dy) * state.world.width + point.x + dx);
  return cells;
}
function farmsInFootprint(state: GameState, footprint: ReadonlySet<number>, faction: number): Building[] {
  return state.buildings.filter(building => building.hp > 0 && isFarmKind(building.kind) && building.faction === faction
    && footprint.has(building.y * state.world.width + building.x)).sort((a, b) => a.id - b.id);
}
/** Farms under a proposed building's footprint. */
export function farmsUnderBuilding(state: GameState, kind: BuildingKind, point: Point, faction: number): Building[] {
  return farmsInFootprint(state, buildingFootprint(state, kind, point), faction);
}
interface BuildingPlans { world: GameState['world']; tiles: GameState['world']['tiles']; signature: string; plans: Map<string, BuildingFarmRelocations | undefined>; }
const buildingPlans = new WeakMap<GameState, BuildingPlans>();

/** Quote every displaced crop together. A partial result never authorizes construction. */
export function planBuildingFarmRelocations(state: GameState, kind: BuildingKind, point: Point, faction: number): BuildingFarmRelocations | undefined {
  if (!buildingDisplacesFarms(kind)) return;
  const footprint = buildingFootprint(state, kind, point), farms = farmsInFootprint(state, footprint, faction);
  if (!farms.length) return { kind, faction, point: { ...point }, farms: [] };
  const signature = farmRelocationSignature(state);
  let cached = buildingPlans.get(state);
  if (!cached || cached.world !== state.world || cached.tiles !== state.world.tiles || cached.signature !== signature) {
    cached = { world: state.world, tiles: state.world.tiles, signature, plans: new Map() }; buildingPlans.set(state, cached);
  }
  const key = `${kind}:${faction}:${point.x},${point.y}`;
  if (cached.plans.has(key)) return cached.plans.get(key);
  const destinations = new Set<number>(), plans: FarmRelocationPlan[] = [], city = farmCityQuery(state, faction);
  const sources = new Set(farms.map(farm => farm.y * state.world.width + farm.x));
  for (const farm of farms) {
    const palace = city(farm);
    const plan = palace && planFarmRelocation(state, palace, farm, point, undefined,
      { nearby: true, unfinished: true, reservedTiles: footprint, reservedPlots: destinations, removedFarmCells: sources });
    if (!plan) { cached.plans.set(key, undefined); return; }
    plans.push(plan); destinations.add(plan.to.y * state.world.width + plan.to.x);
  }
  if (!farmBlockPlacementQuery(state, { removedCells: sources }).canAddAll(plans.map(plan => plan.to)).ok) {
    cached.plans.set(key, undefined); return;
  }
  const batch = { kind, faction, point: { ...point }, farms: plans };
  cached.plans.set(key, batch);
  return batch;
}

/** Check the whole batch before changing any crop, building, treasury, or worker. */
export function relocateBuildingFarms(state: GameState, batch: BuildingFarmRelocations): boolean {
  if (!buildingDisplacesFarms(batch.kind)) return false;
  const footprint = buildingFootprint(state, batch.kind, batch.point);
  const farms = farmsInFootprint(state, footprint, batch.faction), ids = new Set(batch.farms.map(plan => plan.camp));
  if (ids.size !== batch.farms.length || farms.length !== ids.size || farms.some(farm => !ids.has(farm.id))) return false;
  const destinations = new Set(batch.farms.map(plan => plan.to.y * state.world.width + plan.to.x));
  const sources = new Set(farms.map(farm => farm.y * state.world.width + farm.x));
  if (destinations.size !== batch.farms.length
    || !farmBlockPlacementQuery(state, { removedCells: sources }).canAddAll(batch.farms.map(plan => plan.to)).ok) return false;
  for (const plan of batch.farms) {
    const otherDestinations = new Set(destinations); otherDestinations.delete(plan.to.y * state.world.width + plan.to.x);
    const camp = farms.find(farm => farm.id === plan.camp), palace = state.buildings.find(building => building.id === plan.palace);
    if (!camp || !palace || camp.x !== plan.from.x || camp.y !== plan.from.y) return false;
    const valid = planFarmRelocation(state, palace, camp, batch.point, undefined,
      { nearby: true, unfinished: true, reservedTiles: footprint, reservedPlots: otherDestinations, removedFarmCells: sources, destination: plan.to });
    if (!valid) return false;
  }
  for (const plan of batch.farms) applyFarmRelocation(state, plan);
  if (batch.farms.length) finishFarmRelocations(state);
  return true;
}

function farmRelocationSignature(state: GameState): string {
  // Construction previews own their writes and publish every moved farm or
  // added reservation. Repeated validation of the same cell needs no second
  // serialization of the entire settlement. Public/editor calls stay exact.
  if (simulationReadsActive(state)) return `${forbiddenRevision(state)}|${state.world.revision ?? 0}|${territory(state).revision}|${entityStore(state).buildings.revision}|${structureChangeRevision(state)}|${state.farmVersion}|${state.factions.map(f => `${f.id},${f.relation},${f.defeated},${f.population}`).join(';')}`;
  return `${forbiddenRevision(state)}|${state.world.revision ?? 0}|${territory(state).revision}|${state.buildings.map(b => `${b.id},${b.kind},${b.faction},${b.x},${b.y},${b.hp > 0},${buildingReady(b)},${buildingPresent(b)},${!!b.farmSuppressed}`).join(';')}|${(state.fields ?? []).map(f => `${f.camp},${f.faction},${f.x},${f.y}`).join(';')}|${state.factions.map(f => `${f.id},${f.relation},${f.defeated},${f.population}`).join(';')}|${state.villages?.map(v => `${v.id},${v.faction},${v.campId},${v.destroyed}`).join(';')}`;
}

interface WallPlans { world: GameState['world']; tiles: GameState['world']['tiles']; signature: string; plans: Map<string, FarmRelocationPlan | undefined>; }
const wallPlans = new WeakMap<GameState, WallPlans>();
export function planWallFarmRelocation(state: GameState, point: Point, faction: number, reservedTiles?: ReadonlySet<number>): FarmRelocationPlan | undefined {
  return planInfrastructureFarmRelocation(state, point, faction, reservedTiles, false);
}
export function planRoadFarmRelocation(state: GameState, point: Point, faction: number, reservedTiles?: ReadonlySet<number>): FarmRelocationPlan | undefined {
  return planInfrastructureFarmRelocation(state, point, faction, reservedTiles, true);
}
function planInfrastructureFarmRelocation(state: GameState, point: Point, faction: number, reservedTiles: ReadonlySet<number> | undefined, road: boolean): FarmRelocationPlan | undefined {
  const signature = farmRelocationSignature(state);
  let cached = wallPlans.get(state);
  if (!cached || cached.world !== state.world || cached.tiles !== state.world.tiles || cached.signature !== signature) {
    cached = { world: state.world, tiles: state.world.tiles, signature, plans: new Map() }; wallPlans.set(state, cached);
  }
  const key = `${road}:${faction}:${point.x},${point.y}|${[...(reservedTiles ?? [])].join(',')}`;
  if (cached.plans.has(key)) return cached.plans.get(key);
  const camp = farmAt(state, point, faction);
  const palace = camp && farmCityQuery(state, faction)(camp);
  const plan = camp && palace ? planFarmRelocation(state, palace, camp, point, undefined, { wall: true, road, reservedTiles }) : undefined;
  cached.plans.set(key, plan);
  return plan;
}

/** Commit only a still-valid plan. Harvest deadlines and carried food stay
 * unchanged; outbound couriers repath to the moved crop instead of teleporting. */
export function relocateFarm(state: GameState, plan: FarmRelocationPlan, house: Point, options: FarmRelocationOptions = {}): boolean {
  const camp = state.buildings.find(building => building.id === plan.camp), palace = state.buildings.find(building => building.id === plan.palace);
  if (!camp || !palace || camp.x !== plan.from.x || camp.y !== plan.from.y) return false;
  const fresh = planFarmRelocation(state, palace, camp, house, undefined, { ...options, destination: plan.to });
  if (!fresh || fresh.to.x !== plan.to.x || fresh.to.y !== plan.to.y) return false;
  applyFarmRelocation(state, plan);
  finishFarmRelocations(state);
  return true;
}

/** Apply an already validated move to a private placement-preview snapshot.
 * Only occupancy and terrain affect later stroke cells. Do not reconcile the
 * entire farming economy, rebuild worker roles, or edit shared courier records.
 * Authoritative purchases still use relocateFarm and its live revalidation. */
export function previewFarmRelocation(state: GameState, plan: FarmRelocationPlan): void {
  const farm = state.buildings.find(building => building.id === plan.camp)!;
  const changed: number[] = [];
  const dx = plan.to.x - farm.x, dy = plan.to.y - farm.y;
  for (const field of state.fields ?? []) if (field.camp === farm.id) {
    const oldCell = field.y * state.world.width + field.x;
    const old = tileAt(state.world, field.x, field.y) && (state.world.tiles[oldCell] = { ...state.world.tiles[oldCell] });
    changed.push(oldCell);
    if (old?.farm === farm.faction) delete old.farm;
    field.x += dx; field.y += dy; field.id = field.y * state.world.width + field.x + 1;
    changed.push(field.id - 1);
    const tile = tileAt(state.world, field.x, field.y) && (state.world.tiles[field.id - 1] = { ...state.world.tiles[field.id - 1] });
    if (tile) {
      tile.farm = farm.faction;
      if (['forest', 'jungle', 'swamp'].includes(tile.overlay)) {
        tile.overlay = 'none'; delete tile.palm; delete tile.marsh;
        Object.assign(tile, terrainYields(tile.terrain, 'none'));
        markWorldChanged(state.world, 'sight', changed);
      }
    }
  }
  farm.x = plan.to.x; farm.y = plan.to.y;
  recordWorldTileChanges(state.world, changed);
  if (farm.construction) { farm.construction.waitingForBuilder = true; farm.construction.cleared = false; }
  invalidateNavigation(state);
}

/** Called only after every move in the transaction has passed validation. */
function applyFarmRelocation(state: GameState, plan: FarmRelocationPlan): void {
  const camp = state.buildings.find(building => building.id === plan.camp)!;
  const changed: number[] = [];
  const dx = plan.to.x - camp.x, dy = plan.to.y - camp.y, ids = new Map<number, number>();
  for (const field of state.fields ?? []) if (field.camp === camp.id) {
    const oldTile = tileAt(state.world, field.x, field.y);
    changed.push(field.y * state.world.width + field.x);
    if (oldTile?.farm === camp.faction) delete oldTile.farm;
    const oldId = field.id;
    field.x += dx; field.y += dy; field.id = field.y * state.world.width + field.x + 1;
    changed.push(field.id - 1);
    ids.set(oldId, field.id);
    // Relocation is an atomic edit, while global farm reconciliation is sampled.
    // Publish the moved plot itself now so another order cannot reuse its ground.
    const tile = tileAt(state.world, field.x, field.y);
    if (tile) {
      const clearsCover = ['forest', 'jungle', 'swamp'].includes(tile.overlay);
      tile.farm = camp.faction; delete tile.palm; delete tile.marsh;
      if (clearsCover) { tile.overlay = 'none'; Object.assign(tile, terrainYields(tile.terrain, 'none')); }
      markWorldChanged(state.world, clearsCover ? 'sight' : 'appearance', changed);
    }
  }
  for (const [ox, oy] of CAMP_FIELD_OFFSETS) {
    const tile = tileAt(state.world, camp.x + ox, camp.y + oy);
    if (tile?.farm === camp.faction) delete tile.farm;
    changed.push((camp.y + oy) * state.world.width + camp.x + ox);
  }
  camp.x = plan.to.x; camp.y = plan.to.y;
  recordWorldTileChanges(state.world, changed);
  const site = camp.construction;
  if (site) {
    // Active work freezes until its builder reaches the new plot. An order
    // that has never started retains zero progress and its original payment.
    if (!site.waitingForBuilder) site.pausedAt = state.time;
    site.waitingForBuilder = true; site.cleared = false;
  }
  for (const unit of state.units) {
    if (site && unit.builder && unit.buildSite === camp.id) {
      unit.buildPhase = 'outbound'; unit.destination = undefined; unit.path = undefined;
      unit.pathGoal = undefined; unit.repathAt = 0; unit.moving = false;
    }
    if (unit.cargoField !== undefined && ids.has(unit.cargoField)) unit.cargoField = ids.get(unit.cargoField);
    if (unit.field !== undefined && ids.has(unit.field)) {
      unit.field = ids.get(unit.field);
      unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
      unit.moving = false;
    }
  }
}

const relocationBatches = new WeakMap<GameState, { changed: boolean }>();

/** A road stroke moves crop records immediately but reconciles their city and
 * parcel economy once, after all accepted cells have finished. */
export function withFarmRelocationBatch<T>(state: GameState, run: () => T): T {
  if (relocationBatches.has(state)) return run();
  const batch = { changed: false }; relocationBatches.set(state, batch);
  try { return run(); }
  finally {
    relocationBatches.delete(state);
    if (batch.changed) synchronizeFarms(state);
  }
}

function finishFarmRelocations(state: GameState): void {
  markWorldChanged(state.world, 'appearance', []);
  state.farmVersion = (state.farmVersion ?? 0) + 1;
  // Existing field objects changed IDs and positions. Queries must stop using
  // the previous lookup even when the next global staffing pass is not due.
  invalidateScheduledHarvests(state);
  invalidateNavigation(state);
  const batch = relocationBatches.get(state);
  if (batch) batch.changed = true;
  else synchronizeFarms(state);
}
