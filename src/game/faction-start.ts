import { buildingHeight, buildingWidth, isWallKind, tileAt, WATER, type Building, type GameState, type Point } from './types';
import { ridgeFootprintAllowed } from './ridges';
import { canWalk, findPath, hasStaticPath, invalidateNavigation, travelTimeMapFrom } from './pathfinding';
import { constructionEdges } from './builders';

type InitialDefenseKind = 'palisade' | 'road' | 'woodenTower';
type Create = (kind: InitialDefenseKind, point: Point) => Building;
const key = (point: Point): string => `${point.x},${point.y}`;
const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const NEIGHBORS = [...CARDINAL, [-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

/** Complete timber defenses are a starting grant. Gates use the same owned
 * road/wall layers as player-built gates, so civilians retain physical access.
 * Coastlines and impassable cliffs are natural parts of the enclosure. */
export function establishFactionStartingDefenses(state: GameState, palace: Building, create: Create): void {
  const occupied = new Set<string>(), roads = new Set<string>();
  for (const building of state.buildings) if (building.hp > 0) {
    if (building.kind === 'road' && building.faction === palace.faction) { roads.add(key(building)); continue; }
    for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++)
      occupied.add(key({ x: building.x + dx, y: building.y + dy }));
  }
  const terrain = (point: Point): boolean => {
    const tile = tileAt(state.world, point.x, point.y);
    return !!tile && !tile.marsh && !WATER.has(tile.terrain)
      && !['volcano', 'glacier'].includes(tile.overlay) && ridgeFootprintAllowed(state.world, point.x, point.y);
  };
  // The first clear rectangle encloses the starting homes and fields without
  // replacing productive buildings. Tight fixture maps use their map edge.
  let perimeter: Point[] = [], bounds = { left: 0, right: 0, top: 0, bottom: 0 };
  let interior: Set<string> | undefined;
  const obstructions = (ring: Point[]): number => ring.filter(point => occupied.has(key(point)) || !terrain(point)).length;
  for (let radius = 4; radius <= 10; radius++) {
    const candidate = { left: Math.max(0, palace.x - radius), right: Math.min(state.world.width - 1, palace.x + radius + 1),
      top: Math.max(0, palace.y - radius), bottom: Math.min(state.world.height - 1, palace.y + radius + 1) };
    const ring: Point[] = [];
    for (let x = candidate.left; x <= candidate.right; x++) ring.push({ x, y: candidate.top }, { x, y: candidate.bottom });
    for (let y = candidate.top + 1; y < candidate.bottom; y++) ring.push({ x: candidate.left, y }, { x: candidate.right, y });
    bounds = candidate;
    if (!obstructions(ring)) { bounds = candidate; perimeter = ring; break; }
  }
  if (!perimeter.length) {
    // A marsh, ford or stair is walkable even though it cannot support a wall.
    // Follow the edge of buildable ground instead of leaving that crossing open.
    // Peel occupied edge cells inward (usually remote farms) without removing
    // any building. The resulting contour has no missing passable wall cells.
    const region = new Map<string, Point>();
    for (let y = bounds.top; y <= bounds.bottom; y++) for (let x = bounds.left; x <= bounds.right; x++)
      if (terrain({ x, y })) region.set(key({ x, y }), { x, y });
    const boundary = (): Point[] => [...region.values()].filter(point => NEIGHBORS.some(([dx, dy]) => !region.has(key({ x: point.x + dx, y: point.y + dy }))));
    for (let attempt = 0; attempt < 64; attempt++) {
      const edge = boundary(), blocked = edge.filter(point => occupied.has(key(point)));
      if (!blocked.length) { perimeter = edge; break; }
      if (blocked.some(point => point.x >= palace.x && point.x < palace.x + buildingWidth(palace)
        && point.y >= palace.y && point.y < palace.y + buildingHeight(palace))) break;
      for (const point of blocked) region.delete(key(point));
    }
    // Keep only the connected town region, never a disconnected offshore strip.
    const reached = new Set<string>(), queue: Point[] = [{ x: palace.x, y: palace.y }];
    for (let index = 0; index < queue.length; index++) {
      const point = queue[index], cell = key(point);
      if (reached.has(cell) || !region.has(cell)) continue;
      reached.add(cell);
      for (const [dx, dy] of CARDINAL) queue.push({ x: point.x + dx, y: point.y + dy });
    }
    for (const cell of region.keys()) if (!reached.has(cell)) region.delete(cell);
    const edge = boundary();
    if (edge.every(point => !occupied.has(key(point)))) { perimeter = edge; interior = reached; }
    else perimeter = [];
  }
  const gates = new Set<string>();
  const exits = constructionEdges(state, palace);
  const inRegion = (point: Point): boolean => interior ? interior.has(key(point))
    : point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
  const plannedWalls: Building[] = perimeter.map((point, index) => ({ id: -10000 - index, ...point, kind: 'palisade',
    faction: palace.faction, hp: 100, maxHp: 100, capacity: 0 }));
  for (const desired of [
    { x: palace.x, y: bounds.top }, { x: palace.x + 1, y: bounds.bottom },
    { x: bounds.left, y: palace.y + 1 }, { x: bounds.right, y: palace.y },
  ]) {
    const candidates = perimeter.slice().sort((a, b) => Math.hypot(a.x - desired.x, a.y - desired.y)
      - Math.hypot(b.x - desired.x, b.y - desired.y) || a.y - b.y || a.x - b.x);
    const gate = candidates.find(point => !gates.has(key(point))
      && CARDINAL.some(([dx, dy]) => !inRegion({ x: point.x + dx, y: point.y + dy })
        && canWalk(state, point.x + dx + .5, point.y + dy + .5, palace.faction))
      && (() => {
        const opened: Building[] = [...gates, key(point)].map((cell, index) => {
          const [x, y] = cell.split(',').map(Number);
          return { id: -20000 - index, x, y, kind: 'road', faction: palace.faction, hp: 1, maxHp: 1, capacity: 0 };
        });
        const planning = { ...state, buildings: [...state.buildings, ...plannedWalls, ...opened] };
        return exits.some(exit => hasStaticPath(planning, exit, { x: point.x + .5, y: point.y + .5 }, palace.faction));
      })());
    if (gate) gates.add(key(gate));
  }
  for (const point of perimeter) {
    if (gates.has(key(point)) && !roads.has(key(point))) { create('road', point); roads.add(key(point)); }
    create('palisade', point); occupied.add(key(point));
  }
  // Four independent approaches receive a watchtower, with nearby alternatives
  // when shoreline, farms, or a plateau occupy an ideal corner.
  const towers: Point[] = [];
  for (const corner of [
    { x: bounds.left + 1, y: bounds.top + 1 }, { x: bounds.right - 1, y: bounds.bottom - 1 },
    { x: bounds.right - 1, y: bounds.top + 1 }, { x: bounds.left + 1, y: bounds.bottom - 1 },
  ]) {
    const candidates: Point[] = [];
    for (let y = bounds.top + 1; y < bounds.bottom; y++) for (let x = bounds.left + 1; x < bounds.right; x++)
      candidates.push({ x, y });
    candidates.sort((a, b) => Math.hypot(a.x - corner.x, a.y - corner.y) - Math.hypot(b.x - corner.x, b.y - corner.y) || a.y - b.y || a.x - b.x);
    const point = candidates.find(point => terrain(point) && (!interior || interior.has(key(point))) && !occupied.has(key(point)) && !roads.has(key(point))
      && [...gates].every(gate => { const [x, y] = gate.split(',').map(Number); return Math.hypot(point.x - x, point.y - y) >= 2; })
      && towers.every(tower => Math.hypot(point.x - tower.x, point.y - tower.y) >= 3));
    if (point) { create('woodenTower', point); occupied.add(key(point)); towers.push(point); }
  }
  invalidateNavigation(state);
}

/** Finalize once after every city and tower for this faction has been placed.
 * Deferring avoids repeating full-map reachability for earlier capitals. */
export function ensureFactionStartingExits(state: GameState, faction: number, create: Create): void {
  // A second nearby enclosure can cut the first city's former gate approach.
  // Validate a real outward route for every owned town after the final towers,
  // opening owned gate layers wherever that route crosses friendly palisades.
  for (const city of state.buildings.filter(building => building.kind === 'palace' && building.faction === faction))
    ensureStartingCityExit(state, city, create);
}

function ensureStartingCityExit(state: GameState, palace: Building, create: Create): void {
  const walls = state.buildings.filter(building => isWallKind(building.kind) && building.faction === palace.faction && building.hp > 0);
  if (!walls.length) return;
  const planning = { ...state, buildings: state.buildings.filter(building => !walls.includes(building)) };
  const exits = constructionEdges(planning, palace), width = state.world.width;
  const travel = travelTimeMapFrom(planning, exits, palace.faction, 1, Infinity);
  let goal: Point | undefined, shortest = Infinity;
  for (let cell = 0; cell < travel.length; cell++) {
    if (travel[cell] >= shortest) continue;
    const point = { x: cell % width + .5, y: Math.floor(cell / width) + .5 };
    if (Math.hypot(point.x - palace.x - 1, point.y - palace.y - 1) < 16) continue;
    shortest = travel[cell]; goal = point;
  }
  const goals = goal ? [goal] : [];
  for (const city of state.buildings.filter(building => building.kind === 'palace' && building.faction === palace.faction && building !== palace)) {
    const connection = constructionEdges(planning, city).filter(point => Number.isFinite(travel[Math.floor(point.y) * width + Math.floor(point.x)]))
      .sort((a, b) => travel[Math.floor(a.y) * width + Math.floor(a.x)] - travel[Math.floor(b.y) * width + Math.floor(b.x)])[0];
    if (connection) goals.push(connection);
  }
  const roads = new Set(state.buildings.filter(building => building.kind === 'road' && building.hp > 0).map(key));
  for (const goal of goals) {
    if (exits.some(exit => hasStaticPath(state, exit, goal, palace.faction))) continue;
    const path = exits.map(exit => findPath(planning, exit, goal, palace.faction, false, undefined, undefined, undefined, true))
      .filter(path => path.length).sort((a, b) => a.length - b.length)[0];
    if (!path) continue;
    const crossing = new Set(path.map(point => key({ x: Math.floor(point.x), y: Math.floor(point.y) })));
    // Cardinal routing is preferred; a required diagonal also needs both side
    // cells open, matching the movement system's no-corner-cutting rule.
    for (let index = 1; index < path.length; index++) {
      const previous = path[index - 1], point = path[index];
      if (Math.floor(previous.x) !== Math.floor(point.x) && Math.floor(previous.y) !== Math.floor(point.y)) {
        crossing.add(key({ x: Math.floor(previous.x), y: Math.floor(point.y) }));
        crossing.add(key({ x: Math.floor(point.x), y: Math.floor(previous.y) }));
      }
    }
    for (const wall of walls) if (crossing.has(key(wall)) && !roads.has(key(wall))) { create('road', wall); roads.add(key(wall)); }
    invalidateNavigation(state);
  }
}
