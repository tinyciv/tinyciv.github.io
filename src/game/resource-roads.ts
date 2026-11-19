import { territoryValue } from './territory-cells';
import { buildingOverlapsVillageBorders } from './border-placement';
import { territory } from './borders';
import { constructionEdges } from './builders';
import { civilianWorkforcePopulations } from './civilian-population';
import { entityStore } from './entity-store';
import { createNetworkPlacementQuery, validateNetworkPlacement, MIN_GATE_SPACING, MIN_ROAD_JUNCTION_SPACING } from './network-placement';
import { canTraverseEdge, canWalk, hasStaticPath, invalidateNavigation, terrainNavigationEdges, withNavigationFrame } from './pathfinding';
import { reliefFootprintAllowed } from './relief';
import { hermitCabinOverlaps, placementOccupancy } from './placement-occupancy';
import { overlapsFallenDefense } from './defense-rebuilding';
import { simulationReadsActive } from './simulation-reads';
import { southernResourceCell } from './resource-worksite';
import { removeVillageTrailAt } from './village-trails';
import { markWorldChanged } from './world-revisions';
import { buildingHeight, buildingPresent, buildingReady, buildingWidth, constructionSiteHidden, distance, tileAt, WATER,
  type Building, type GameState, type Point, type RegionalResource, type Unit } from './types';

export interface ResourceRoadJourney {
  home: number;
  /** Physical departure/arrival locations, outside the settlement/resource. */
  exit: Point;
  goal: Point;
  /** Cardinal cell centers, including the departure cell. */
  path: Point[];
  /** Same ordered corridor, including existing roads and natural crossings. */
  roadCells: Point[];
}
const CARDINAL = [[0, 1], [1, 0], [-1, 0], [0, -1]] as const;
const CARDINAL_BITS = [64, 16, 8, 2] as const;
const key = (state: GameState, point: Point) => Math.floor(point.y) * state.world.width + Math.floor(point.x);
const center = (state: GameState, cell: number): Point => ({ x: cell % state.world.width + .5, y: Math.floor(cell / state.world.width) + .5 });
const isRoute = (building: Building) => (building.kind === 'road' || building.kind === 'bridge') && buildingReady(building);
const roadOccupant = (building: Building) => buildingPresent(building)
  || building.hp > 0 && constructionSiteHidden(building) || building.kind === 'fort' && !!building.fort?.destroyed;
function buildingsAt(state: GameState, x: number, y: number): Building[] {
  if (simulationReadsActive(state)) return placementOccupancy(state).at(x, y).filter(roadOccupant);
  return state.buildings.filter(building => roadOccupant(building) && x >= building.x && x < building.x + buildingWidth(building)
    && y >= building.y && y < building.y + buildingHeight(building));
}

/** Already usable routes are traversed, never replaced or charged again. */
export function resourceRoadTileReady(state: GameState, faction: number, point: Point): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !canWalk(state, point.x, point.y, faction, undefined, true)) return false;
  const x = Math.floor(point.x), y = Math.floor(point.y), tile = tileAt(state.world, x, y);
  return tile?.terrain === 'river' && tile.overlay === 'ford' || buildingsAt(state, x, y).some(isRoute);
}

function terrainCanReceiveRoad(state: GameState, faction: number, x: number, y: number, occupants: readonly Building[], reservationsChecked = false, walkabilityChecked = false): boolean {
  const tile = tileAt(state.world, x, y);
  if (!tile || WATER.has(tile.terrain) || tile.resource && tile.oreAnchor === undefined || tile.farm !== undefined
    || overlapsFallenDefense(state, 'road', x, y) || hermitCabinOverlaps(state, x, y)
    || !reliefFootprintAllowed(state.world, x, y) || !walkabilityChecked && !canWalk(state, x + .5, y + .5, faction, undefined, true)) return false;
  // Access roads preserve crops and trees. They do not demolish structures,
  // relocate farms, open new gates, or build new crossings over water.
  if (!reservationsChecked && (state.fields?.some(field => field.x === x && field.y === y)
    || buildingOverlapsVillageBorders(state, 'road', x, y, faction))) return false;
  return occupants.every(building => building.kind === 'irrigation' && building.faction === faction);
}

/** Reusable numeric search storage avoids allocating thousands of map entries
 * and heap objects whenever an inaccessible resource retries its access road.
 * The score/cell ordering and bounded expansion count match the original A*. */
class RoadSearch {
  busy = false;
  stamp = 0;
  readonly allowed: Uint8Array;
  readonly seen: Uint32Array;
  readonly costs: Float64Array;
  readonly previous: Int32Array;
  private cells = new Int32Array(128);
  private scores = new Float64Array(128);
  private queuedCosts = new Float64Array(128);
  length = 0;
  poppedCost = 0;
  constructor(count: number) {
    this.allowed = new Uint8Array(count); this.seen = new Uint32Array(count);
    this.costs = new Float64Array(count); this.previous = new Int32Array(count);
  }
  reset(): void {
    this.length = 0; this.stamp = (this.stamp + 1) >>> 0;
    if (!this.stamp) { this.seen.fill(0); this.stamp = 1; }
  }
  private before(score: number, cell: number, index: number): boolean {
    return score < this.scores[index] || score === this.scores[index] && cell < this.cells[index];
  }
  private copy(to: number, from: number): void {
    this.cells[to] = this.cells[from]; this.scores[to] = this.scores[from]; this.queuedCosts[to] = this.queuedCosts[from];
  }
  push(cell: number, cost: number, score: number): void {
    if (this.length === this.cells.length) {
      const cells = new Int32Array(this.length * 2), scores = new Float64Array(this.length * 2), costs = new Float64Array(this.length * 2);
      cells.set(this.cells); scores.set(this.scores); costs.set(this.queuedCosts);
      this.cells = cells; this.scores = scores; this.queuedCosts = costs;
    }
    let index = this.length++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.before(score, cell, parent)) break;
      this.copy(index, parent); index = parent;
    }
    this.cells[index] = cell; this.scores[index] = score; this.queuedCosts[index] = cost;
  }
  pop(): number {
    const first = this.cells[0]; this.poppedCost = this.queuedCosts[0];
    const last = --this.length;
    if (!last) return first;
    const cell = this.cells[last], score = this.scores[last], cost = this.queuedCosts[last];
    let index = 0;
    while (index * 2 + 1 < last) {
      let child = index * 2 + 1;
      if (child + 1 < last && this.before(this.scores[child + 1], this.cells[child + 1], child)) child++;
      if (!this.before(this.scores[child], this.cells[child], last)) break;
      this.copy(index, child); index = child;
    }
    this.cells[index] = cell; this.scores[index] = score; this.queuedCosts[index] = cost;
    return first;
  }
}
const searches = new WeakMap<GameState['world'], RoadSearch[]>();
function acquireRoadSearch(state: GameState): RoadSearch {
  let pool = searches.get(state.world);
  if (!pool) { pool = []; searches.set(state.world, pool); }
  let search = pool.find(value => !value.busy && value.allowed.length === state.world.tiles.length);
  if (!search) { search = new RoadSearch(state.world.tiles.length); pool.push(search); }
  search.busy = true; search.allowed.fill(0);
  return search;
}

/** A road appears only beneath the civilian actually working on that cell. */
export function buildResourceRoadTile(state: GameState, unit: Unit, point: Point): boolean {
  if (unit.kind !== 'worker' || unit.hp <= 0 || unit.inside || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const x = Math.floor(point.x), y = Math.floor(point.y), target = { x: x + .5, y: y + .5 };
  if (Math.floor(unit.x) !== x || Math.floor(unit.y) !== y || distance(unit, target) > .55) return false;
  if (resourceRoadTileReady(state, unit.faction, target)) return true;
  if (!terrainCanReceiveRoad(state, unit.faction, x, y, buildingsAt(state, x, y))
    || !validateNetworkPlacement(state, 'road', x, y, unit.faction).ok) return false;
  let id = 0;
  for (const building of state.buildings) id = Math.max(id, building.id);
  for (const other of state.units) id = Math.max(id, other.id);
  entityStore(state).buildings.add({ id: id + 1, kind: 'road', faction: unit.faction, x, y,
    hp: 100, maxHp: 100, capacity: 0, armor: 2 });
  const removedTrail = removeVillageTrailAt(state.world, x, y);
  delete state.traffic?.[String(y * state.world.width + x)];
  markWorldChanged(state.world, removedTrail ? 'appearance' : 'structure', removedTrail ? [y * state.world.width + x] : []);
  invalidateNavigation(state);
  return true;
}

/** Local dependencies of a corridor include every cell it uses and the road/
 * wall neighborhood inspected by network placement. Remote edits do not throw
 * away already checked chunks; changing a local dependency restarts safely. */
function corridorValidation(state: GameState, city: Building, path: readonly number[], resources: ReadonlySet<number>) {
  const width = state.world.width, faction = city.faction;
  const fields = new Set(state.fields?.map(field => field.y * width + field.x));
  const villages = new Set(state.villages?.filter(village => !village.destroyed && village.faction !== faction).map(village => village.faction));
  const borders = villages.size ? territory(state) : undefined;
  const allowed = new Set<number>(), ready = new Set<number>(), nearby = new Set<number>(), signature: (string | number | boolean)[] = [];
  const radius = Math.max(Math.ceil(MIN_GATE_SPACING) * 2, Math.ceil(MIN_ROAD_JUNCTION_SPACING) + 2);
  const exits = new Set(constructionEdges(state, city, true).map(point => key(state, point)));
  signature.push(city.id, city.x, city.y, faction, buildingReady(city), exits.has(path[0]));
  for (let index = 0; index < path.length; index++) {
    const cell = path[index], x = cell % width, y = Math.floor(cell / width), structures = buildingsAt(state, x, y);
    const walkable = canWalk(state, x + .5, y + .5, faction, undefined, true);
    const existing = walkable && (structures.some(isRoute) || state.world.tiles[cell]?.terrain === 'river' && state.world.tiles[cell]?.overlay === 'ford');
    const legal = (index > 0 || exits.has(cell)) && walkable
      && (!index || canTraverseEdge(state.world, center(state, path[index - 1]), center(state, cell)))
      && (existing || !resources.has(cell) && !fields.has(cell) && !villages.has(territoryValue(borders, cell) ?? -999)
        && terrainCanReceiveRoad(state, faction, x, y, structures, true, true));
    if (legal) allowed.add(cell);
    if (existing) ready.add(cell);
    signature.push(cell, !!legal, !!existing);
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++)
      if (x + dx >= 0 && y + dy >= 0 && x + dx < width && y + dy < state.world.height) nearby.add((y + dy) * width + x + dx);
  }
  for (const building of state.buildings) if (building.hp > 0 && nearby.has(building.y * width + building.x)
    && (building.kind === 'road' || building.kind === 'bridge' || building.kind === 'wall' || building.kind === 'palisade'))
    signature.push(building.kind, building.x, building.y, building.faction);
  return { allowed, ready, signature: signature.join('|') };
}

type RoadWork = 'search' | 'validation';
interface RoadControl { check?: () => boolean; network?: ReturnType<typeof createNetworkPlacementQuery> }
export interface ResourceRoadProgress { done: boolean; journey?: ResourceRoadJourney; invalidated?: boolean; expansions: number; validations: number }
export interface ResourceRoadCursor {
  advance(maxExpansions?: number, maxValidations?: number, revision?: string): ResourceRoadProgress;
  cancel(): void;
}

/** Own one reusable frontier while suspended. Read/navigation scopes exist
 * only for each advance; cancellation releases the buffer immediately. */
export function createResourceRoadCursor(state: GameState, city: Building, cells: readonly number[], _resource?: RegionalResource): ResourceRoadCursor {
  const world = state.world, tiles = world.tiles, width = world.width, height = world.height, faction = city.faction, x = city.x, y = city.y;
  const registered = entityStore(state).buildings.get(city.id) === city;
  const control: RoadControl = {};
  let task: Generator<RoadWork, ResourceRoadJourney | undefined, void> | undefined, done = false, revision: string | undefined;
  const cancel = () => { if (task) task.return(undefined); done = true; };
  return { cancel, advance(maxExpansions = 1024, maxValidations = 64, currentRevision) {
    const result: ResourceRoadProgress = { done, expansions: 0, validations: 0 };
    if (done) return result;
    if (state.world !== world || state.world.tiles !== tiles || world.width !== width || world.height !== height || city.x !== x || city.y !== y || city.faction !== faction || !buildingReady(city)
      || registered && entityStore(state).buildings.get(city.id) !== city) {
      cancel(); return { ...result, done: true, invalidated: true };
    }
    return withNavigationFrame(state, () => {
      if (control.check && (!simulationReadsActive(state) || currentRevision === undefined || revision !== currentRevision) && !control.check()) {
        cancel(); return { ...result, done: true, invalidated: true };
      }
      revision = currentRevision; control.network = undefined;
      if (!task) task = resourceRoadSteps(state, city, cells, control);
      while (result.expansions < maxExpansions && result.validations < maxValidations) {
        const step = task.next();
        if (step.done) { done = true; return { ...result, done: true, journey: step.value }; }
        if (step.value === 'search') result.expansions++; else result.validations++;
      }
      return result;
    });
  } };
}

/** Direct orders retain immediate completion using the same ordered search. */
export function resourceRoadJourney(state: GameState, city: Building, cells: readonly number[], resource?: RegionalResource): ResourceRoadJourney | undefined {
  const cursor = createResourceRoadCursor(state, city, cells, resource);
  try { return cursor.advance(Infinity, Infinity).journey; } finally { cursor.cancel(); }
}

function* resourceRoadSteps(state: GameState, city: Building, cells: readonly number[], control: RoadControl): Generator<RoadWork, ResourceRoadJourney | undefined, void> {
  if (city.kind !== 'palace' || !buildingReady(city)) return;
  const developed = cells.filter(cell => Number.isSafeInteger(cell) && cell >= 0 && cell < state.world.tiles.length);
  // A partly purchased clump still has one complete physical footprint and
  // entrance. Route to its outside edge, including its undeveloped rock cells.
  const footprint = new Set(developed), anchors = new Set<number>();
  for (const cell of developed) {
    const tile = state.world.tiles[cell], anchor = tile.oreAnchor;
    if (anchor === undefined || anchors.has(anchor)) continue;
    anchors.add(anchor);
    const source = state.world.tiles[anchor], x = anchor % state.world.width, y = Math.floor(anchor / state.world.width);
    for (let dy = 0; dy < (source.oreHeight ?? 1); dy++) for (let dx = 0; dx < (source.oreWidth ?? 1); dx++)
      footprint.add((y + dy) * state.world.width + x + dx);
  }
  const valid = [...footprint];
  const anchor = southernResourceCell(valid, state.world.width);
  if (anchor === undefined) return;
  const workspace = acquireRoadSearch(state);
  try {
    const { width, height } = state.world, faction = city.faction;
    const resourceCells = new Set(valid), occupants = new Map<number, Building[]>();
    const occupancy = simulationReadsActive(state) ? placementOccupancy(state) : undefined;
    // Gameplay placement and worker routes share the same footprint index.
    // Standalone queries still snapshot live, potentially unjournaled edits.
    if (!occupancy) for (const building of state.buildings) if (roadOccupant(building)) {
      for (let y = building.y; y < building.y + buildingHeight(building); y++) for (let x = building.x; x < building.x + buildingWidth(building); x++) {
        const cell = y * width + x, list = occupants.get(cell) ?? []; list.push(building); occupants.set(cell, list);
      }
    }
    const fieldCells = new Set(state.fields?.map(field => field.y * width + field.x));
    const villages = new Set(state.villages?.filter(village => !village.destroyed && village.faction !== faction).map(village => village.faction));
    const borders = villages.size ? territory(state) : undefined;
    // 0 = unchecked, 1 = blocked, 2 = buildable, 3 = existing usable road.
    const allowed = workspace.allowed;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
    const usable = (cell: number): boolean => {
      const cached = allowed[cell]; if (cached) return cached > 1;
      const x = cell % width, y = Math.floor(cell / width), tile = state.world.tiles[cell];
      const structures = occupancy ? occupancy.at(x, y).filter(roadOccupant) : occupants.get(cell) ?? [];
      let okay = inside(x, y) && !!tile && canWalk(state, x + .5, y + .5, faction, undefined, true);
      const ready = okay && (structures.some(isRoute) || tile.terrain === 'river' && tile.overlay === 'ford');
      if (ready) allowed[cell] = 3;
      else okay = okay && !resourceCells.has(cell) && !fieldCells.has(cell) && !villages.has(territoryValue(borders, cell) ?? -999)
        && terrainCanReceiveRoad(state, faction, x, y, structures, true, true);
      if (!ready) allowed[cell] = okay ? 2 : 1;
      return okay;
    };
    const starts = constructionEdges(state, city, true).map(point => key(state, point)).filter(usable);
    if (!starts.length) return;
    const ax = anchor % width, ay = Math.floor(anchor / width), goals: number[] = [];
    // Prefer the unobstructed front of the southmost clump. A blocked front
    // falls back to a different exposed edge rather than bulldozing through it.
    for (const [dx, dy] of CARDINAL) if (inside(ax + dx, ay + dy)) {
      const cell = (ay + dy) * width + ax + dx;
      if (!resourceCells.has(cell) && usable(cell)) goals.push(cell);
    }
    const alternatives = new Set<number>();
    for (const cell of valid) for (const [dx, dy] of CARDINAL) {
      const x = cell % width + dx, y = Math.floor(cell / width) + dy, next = y * width + x;
      if (inside(x, y) && !resourceCells.has(next) && usable(next) && !goals.includes(next)) alternatives.add(next);
    }
    goals.push(...[...alternatives].sort((a, b) => distance(center(state, a), center(state, anchor)) - distance(center(state, b), center(state, anchor)) || a - b));
    if (!goals.length) return;
    // Trusted gameplay mutations maintain this shared exact geometry layer.
    // Public/editor queries keep direct edge reads for unjournaled tile edits.
    const edges = simulationReadsActive(state) ? terrainNavigationEdges(state.world) : undefined;
    let remainingSearch = 12000;
    for (const goal of goals) {
      // Shared terrain components reject disconnected islands without spending
      // the bounded road search on thousands of unrelated mainland cells.
      if (!starts.some(start => hasStaticPath(state, center(state, start), center(state, goal), faction, true))) continue;
      const excluded = new Set<number>();
      for (let attempt = 0; attempt < 12 && remainingSearch > 0; attempt++) {
        const path = yield* search(goal, excluded); if (!path) break;
        // A retained frontier may span unrelated construction edits. Before
        // publication, validate this corridor against one current local view.
        const validation = corridorValidation(state, city, path, resourceCells);
        const network = control.network ??= createNetworkPlacementQuery(state);
        control.check = () => corridorValidation(state, city, path, resourceCells).signature === validation.signature;
        const additions: Building[] = []; let failed: number | undefined;
        for (const cell of path) {
          if (!validation.allowed.has(cell)) { failed = cell; break; }
          if (validation.ready.has(cell)) continue;
          const x = cell % width, y = Math.floor(cell / width);
          const legal = network('road', x, y, faction, additions).ok; yield 'validation';
          if (!legal) { failed = cell; break; }
          additions.push({ id: -additions.length - 1, kind: 'road', faction, x, y, hp: 100, maxHp: 100, capacity: 0 });
        }
        control.check = undefined;
        if (failed !== undefined) { excluded.add(failed); continue; }
        const points = path.map(cell => center(state, cell));
        return { home: city.id, exit: points[0], goal: points[points.length - 1], path: points, roadCells: points.map(point => ({ ...point })) };
      }
    }
    function* search(goal: number, excluded: ReadonlySet<number>): Generator<RoadWork, number[] | undefined, void> {
      const gx = goal % width, gy = Math.floor(goal / width);
      const heuristic = (cell: number) => (Math.abs(cell % width - gx) + Math.abs(Math.floor(cell / width) - gy)) * .65;
      workspace.reset();
      const { costs, previous, seen, stamp } = workspace;
      for (const cell of starts) if (!excluded.has(cell)) {
        costs[cell] = 0; previous[cell] = -1; seen[cell] = stamp; workspace.push(cell, 0, heuristic(cell));
      }
      while (workspace.length && remainingSearch-- > 0) {
        const cell = workspace.pop(), currentCost = workspace.poppedCost; yield 'search';
        if (costs[cell] !== currentCost) continue;
        if (cell === goal) {
          const path:number[]=[];for(let step=goal;step!==-1;step=previous[step])path.push(step);return path.reverse();
        }
        const x=cell%width,y=Math.floor(cell/width);
        for(let direction=0;direction<CARDINAL.length;direction++){
          const [dx,dy]=CARDINAL[direction];
          const nx=x+dx,ny=y+dy,next=ny*width+nx;
          if(!inside(nx,ny)||excluded.has(next)||!usable(next)
            || (edges ? !(edges[cell]&CARDINAL_BITS[direction]) : !canTraverseEdge(state.world,{x,y},{x:nx,y:ny})))continue;
          const cost=currentCost+(allowed[next]===3?.65:1);
          if(seen[next]===stamp && cost>=costs[next])continue;
          costs[next]=cost;previous[next]=cell;seen[next]=stamp;workspace.push(next,cost,cost+heuristic(next));
        }
      }
    }
  } finally { workspace.busy = false; }
}

/** Stable nearest-first origins shared by immediate orders and queued searches. */
export function resourceRoadOrigins(state: GameState, faction: number, cells: readonly number[], populations = civilianWorkforcePopulations(state)): Building[] {
  if (state.gameOver || state.factions.find(owner => owner.id === faction)?.defeated) return [];
  const valid = cells.filter(cell => Number.isSafeInteger(cell) && cell >= 0 && cell < state.world.tiles.length);
  const anchor = southernResourceCell(valid, state.world.width); if (anchor === undefined) return [];
  const destination = center(state, anchor);
  return entityStore(state).buildings.query('palace').filter(city => city.faction === faction && buildingReady(city)
    && (populations.get(city.id) ?? 0) > 0).sort((a,b) => distance({x:a.x+buildingWidth(a)/2,y:a.y+buildingHeight(a)/2},destination)
      - distance({x:b.x+buildingWidth(b)/2,y:b.y+buildingHeight(b)/2},destination) || a.id-b.id);
}

/** Empty or inaccessible settlements do not supply phantom road workers. */
export function planResourceRoad(state: GameState, faction: number, cells: readonly number[], resource?: RegionalResource): ResourceRoadJourney | undefined {
  const cities = resourceRoadOrigins(state, faction, cells);
  for(const city of cities){const result=resourceRoadJourney(state,city,cells,resource);if(result)return result;}
}
