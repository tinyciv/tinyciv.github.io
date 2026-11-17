import { forbiddenRevision, isForbidden } from './forbidden-zones';
import { type Building, type GameState, type Point, buildingPresent, buildingReady, buildingWidth, buildingHeight, isFarmKind, tileAt, WATER } from './types';
import { constructionEdges } from './builders';
import { canTraverseEdge, createReachabilityQuery, withNavigationFrame } from './pathfinding';
import { palaceReachability } from './placement';
import { replaceableRoad } from './covered-roads';
import { reliefFootprintAllowed } from './relief';
import { palaceEnclosures } from './enclosures';
import { planFarmRelocation, withFarmRelocationProbes, type FarmRelocationPlan } from './farm-relocation';
import TinyQueue from 'tinyqueue';

const NEIGHBORS = [-1, 0, 1].flatMap(dy => [-1, 0, 1].filter(dx => dx || dy).map(dx => [dx, dy] as const));
/** `clearFarm`: the farm on this tile has no replacement plot, so the order
 * clears it (refunding half its cost) instead of moving it. */
export interface HouseSitePlan { point: Point; replaceCampId?: number; farmMove?: FarmRelocationPlan; clearFarm?: true; }
interface Candidate { point: Point; distance: number; camp?: Building; }
interface PlacementContext { occupied: Set<number>; farms: Map<number, Building>; activeWells: Set<number>; reservedSolid: Set<number>; }

function placementContext(state: GameState, palace: Building, allowRoads = false): PlacementContext {
  const { width } = state.world, occupied = new Set<number>(), farms = new Map<number, Building>(), activeWells = new Set<number>(), reservedSolid = new Set<number>();
  for (const building of state.buildings) if (building.hp > 0) {
    if (allowRoads && replaceableRoad(building, palace.faction)) continue;
    const shareableWell = building.kind === 'well' && building.faction === palace.faction;
    const movableFarm = isFarmKind(building.kind) && building.faction === palace.faction && buildingReady(building) && !building.farmSuppressed;
    if (shareableWell && buildingPresent(building)) activeWells.add(building.y * width + building.x);
    for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++) {
      const key = (building.y + dy) * width + building.x + dx;
      if (movableFarm) farms.set(key, building);
      else if (!shareableWell) occupied.add(key);
      if (building.construction && !isFarmKind(building.kind) && !['road', 'bridge'].includes(building.kind)) reservedSolid.add(key);
    }
  }
  for (const field of state.fields ?? []) {
    const key = field.y * width + field.x;
    if (farms.get(key)?.id !== field.camp) occupied.add(key);
  }
  return { occupied, farms, activeWells, reservedSolid };
}

function candidateAt(state: GameState, palace: Building, context: PlacementContext, point: Point, allowClearing = false): Candidate | undefined {
  const { x, y } = point, key = y * state.world.width + x;
  if (isForbidden(state, x, y, palace.faction) || context.occupied.has(key) || !reliefFootprintAllowed(state.world, x, y)) return;
  const tile = tileAt(state.world, x, y), camp = context.farms.get(key);
  if (!tile || WATER.has(tile.terrain) || tile.farm !== undefined && !camp) return;
  if (tile.overlay !== 'none' && !(allowClearing && ['forest', 'jungle', 'swamp'].includes(tile.overlay))) return;
  return { point, distance: Math.hypot(x + .5 - palace.x - 1, y + .5 - palace.y - 1), camp };
}

/** Governors preserve short walking routes and access to nearby parcels. */
function reachableSite(state: GameState, palace: Building, reachable: Uint8Array, point: Point, context: PlacementContext): boolean {
  const { width, height } = state.world, key = point.y * width + point.x;
  const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height
    && (x !== point.x || y !== point.y) && !context.reservedSolid.has(y * width + x) && !!reachable[y * width + x];
  const neighbors = NEIGHBORS.map(([dx, dy]) => ({ x: point.x + dx, y: point.y + dy })).filter(p => open(p.x, p.y));
  if (!neighbors.some(p => (p.x === point.x || p.y === point.y) && canTraverseEdge(state.world, p, point))) return false;
  const occupiedByWell = context.activeWells.has(key);
  if (!occupiedByWell && !reachable[key]) return false;
  if (!occupiedByWell) {
    const queue = [neighbors[0]], seen = new Set([neighbors[0].y * width + neighbors[0].x]);
    for (let head = 0; head < queue.length; head++) for (const [dx, dy] of NEIGHBORS) {
      const current = queue[head], x = current.x + dx, y = current.y + dy, index = y * width + x;
      if (Math.abs(x - point.x) > 2 || Math.abs(y - point.y) > 2 || !open(x, y) || seen.has(index)
        || !canTraverseEdge(state.world, current, { x, y })) continue;
      seen.add(index); queue.push({ x, y });
    }
    const localAccess = neighbors.every(p => seen.has(p.y * width + p.x));
    // Governors retain short through-routes for food traffic.
    if (!localAccess) return false;
    if (!context.reservedSolid.size && localAccess) return true;
  }
  const blocked = { has: (index: number) => index === key || context.reservedSolid.has(index) };
  const queries = constructionEdges(state, palace, true).filter(exit => !blocked.has(Math.floor(exit.y) * width + Math.floor(exit.x)))
    .map(exit => createReachabilityQuery(state, exit, palace.faction, blocked, true));
  // A new home must not sever existing access to its surrounding reachable cells.
  return neighbors.every(p => queries.some(query => query({ x: p.x + .5, y: p.y + .5 })));
}

function planCandidate(state: GameState, palace: Building, candidate: Candidate, context: PlacementContext, reachable: Uint8Array,
  canReplaceCamp: (camp: Building) => boolean): HouseSitePlan | undefined {
  if (!reachableSite(state, palace, reachable, candidate.point, context)) return;
  if (!candidate.camp) return { point: candidate.point };
  if (!canReplaceCamp(candidate.camp)) return;
  const farmMove = planFarmRelocation(state, palace, candidate.camp, candidate.point, reachable);
  return farmMove ? { point: candidate.point, replaceCampId: candidate.camp.id, farmMove } : undefined;
}

interface ManualPlans {
  tiles: GameState['world']['tiles']; signature: string;
  plans: Map<string, HouseSitePlan | undefined>; reachable: Map<number, Uint8Array>;
}
const manualPlans = new WeakMap<GameState['world'], ManualPlans>();

/** Read-only manual plan. Hover and placement reuse the exact parcel result
 * until terrain, structures, plots or diplomacy change; crop bags and passing
 * units do not change site validity. Manual homes can clear vegetation and
 * occupy isolated parcels or walking lanes; builders wait for access when
 * necessary. The commit revalidates any free farm move. */
export function planHouseAt(state: GameState, palace: Building, point: Point): HouseSitePlan | undefined {
  if (palace.kind !== 'palace' || !buildingReady(palace)) return;
  const signature = `${forbiddenRevision(state)}|${state.world.revision ?? 0}|${state.buildings.map(b => `${b.id},${b.kind},${b.faction},${b.x},${b.y},${b.hp > 0},${buildingReady(b)},${buildingPresent(b)},${!!b.farmSuppressed}`).join(';')}|${(state.fields ?? []).map(f => `${f.camp},${f.faction},${f.x},${f.y}`).join(';')}|${state.factions.map(f => `${f.id},${f.relation},${f.defeated}`).join(';')}`;
  let cached = manualPlans.get(state.world);
  if (!cached || cached.tiles !== state.world.tiles || cached.signature !== signature) {
    cached = { tiles: state.world.tiles, signature, plans: new Map(), reachable: new Map() };
    manualPlans.set(state.world, cached);
  }
  const key = `${palace.id}:${point.x},${point.y}`;
  if (cached.plans.has(key)) return cached.plans.get(key);
  const context = placementContext(state, palace, true), candidate = candidateAt(state, palace, context, point, true);
  const plan = candidate && withNavigationFrame(state, () => {
    if (!candidate.camp) return { point: candidate.point };
    let reachable = cached!.reachable.get(palace.id);
    if (!reachable) { reachable = palaceReachability(state, palace); cached!.reachable.set(palace.id, reachable); }
    const farmMove = planFarmRelocation(state, palace, candidate.camp, candidate.point, reachable);
    return farmMove ? { point: candidate.point, replaceCampId: candidate.camp.id, farmMove }
      : { point: candidate.point, replaceCampId: candidate.camp.id, clearFarm: true as const };
  });
  cached.plans.set(key, plan);
  return plan;
}
export function canPlaceHouseAt(state: GameState, palace: Building, point: Point): boolean { return !!planHouseAt(state, palace, point); }

/** Enumerate tiles in exact center-distance, row, column order. Every cell has
 * a cardinal path toward the center with nonincreasing distance, so a small
 * frontier can yield the nearest candidates without scanning/sorting the map. */
function* nearestHousingCells(width: number, height: number, palace: Building): Generator<Point> {
  if (!width || !height) return;
  const seen = new Set<number>();
  const queue = new TinyQueue<{ x: number; y: number; distance: number }>([], (a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  const add = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const cell = y * width + x;
    if (seen.has(cell)) return;
    seen.add(cell);
    queue.push({ x, y, distance: Math.hypot(x + .5 - palace.x - 1, y + .5 - palace.y - 1) });
  };
  add(Math.max(0, Math.min(width - 1, Math.ceil(palace.x))), Math.max(0, Math.min(height - 1, Math.ceil(palace.y))));
  while (queue.length) {
    const point = queue.pop()!;
    yield { x: point.x, y: point.y };
    add(point.x - 1, point.y); add(point.x + 1, point.y); add(point.x, point.y - 1); add(point.x, point.y + 1);
  }
}

/** Prefer this city's defended interior, then the nearest suitable cell. No
 * block dimensions or palace-distance cap prevent filling a narrow parcel. */
export function planHouseSite(state: GameState, palace: Building, canReplaceCamp: (camp: Building) => boolean = () => true,
  allowed: (point: Point) => boolean = () => true): HouseSitePlan | undefined {
  if (palace.kind !== 'palace' || !buildingReady(palace)) return;
  return withNavigationFrame(state, () => withFarmRelocationProbes(state, () => {
    const { width, height } = state.world, context = placementContext(state, palace), reachable = palaceReachability(state, palace);
    const region = palaceEnclosures(state).regions.find(region => region.faction === palace.faction && region.palaces.includes(palace.id));
    const enclosed = new Set(region?.cells ?? []);
    const interior = [...enclosed].map(cell => ({ x: cell % width, y: Math.floor(cell / width) }))
      .sort((a, b) => Math.hypot(a.x + .5 - palace.x - 1, a.y + .5 - palace.y - 1)
        - Math.hypot(b.x + .5 - palace.x - 1, b.y + .5 - palace.y - 1) || a.y - b.y || a.x - b.x);
    const planAt = (point: Point) => {
      const cell = point.y * width + point.x;
      if ((!reachable[cell] && !context.activeWells.has(cell)) || !allowed(point)) return;
      const candidate = candidateAt(state, palace, context, point);
      return candidate && planCandidate(state, palace, candidate, context, reachable, canReplaceCamp);
    };
    for (const point of interior) {
      const plan = planAt(point);
      if (plan) return plan;
    }
    const checked = new Set<number>();
    for (const point of nearestHousingCells(width, height, palace)) {
      // A city with no valid site still falls back to one linear terrain pass;
      // never pay a heap operation for every distant forest or forbidden tile.
      if (checked.size >= 1024) break;
      const cell = point.y * width + point.x; checked.add(cell);
      if (enclosed.has(cell)) continue;
      const plan = planAt(point);
      if (plan) return plan;
    }
    const distant: Candidate[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      if (checked.has(cell) || enclosed.has(cell) || (!reachable[cell] && !context.activeWells.has(cell)) || !allowed({ x, y })) continue;
      const candidate = candidateAt(state, palace, context, { x, y });
      if (candidate) distant.push(candidate);
    }
    distant.sort((a, b) => a.distance - b.distance || a.point.y - b.point.y || a.point.x - b.point.x);
    for (const candidate of distant) {
      const plan = planCandidate(state, palace, candidate, context, reachable, canReplaceCamp);
      if (plan) return plan;
    }
  }));
}
export function nearestHouseSite(state: GameState, palace: Building): Point | undefined { return planHouseSite(state, palace)?.point; }
