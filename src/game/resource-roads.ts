import TinyQueue from 'tinyqueue';
import { buildingOverlapsVillageBorders } from './border-placement';
import { territory } from './borders';
import { constructionEdges } from './builders';
import { civilianWorkforcePopulations } from './civilian-population';
import { entityStore } from './entity-store';
import { createNetworkPlacementQuery, validateNetworkPlacement } from './network-placement';
import { canTraverseEdge, canWalk, hasStaticPath, invalidateNavigation, withNavigationFrame } from './pathfinding';
import { ridgeFootprintAllowed } from './ridges';
import { southernResourceCell } from './resource-worksite';
import { removeVillageTrailAt } from './village-trails';
import { markWorldChanged } from './world-revisions';
import { buildingHeight, buildingPresent, buildingReady, buildingWidth, distance, tileAt, WATER,
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
const key = (state: GameState, point: Point) => Math.floor(point.y) * state.world.width + Math.floor(point.x);
const center = (state: GameState, cell: number): Point => ({ x: cell % state.world.width + .5, y: Math.floor(cell / state.world.width) + .5 });
const isRoute = (building: Building) => (building.kind === 'road' || building.kind === 'bridge') && buildingReady(building);
function buildingsAt(state: GameState, x: number, y: number): Building[] {
  return state.buildings.filter(building => buildingPresent(building) && x >= building.x && x < building.x + buildingWidth(building)
    && y >= building.y && y < building.y + buildingHeight(building));
}

/** Already usable routes are traversed, never replaced or charged again. */
export function resourceRoadTileReady(state: GameState, faction: number, point: Point): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !canWalk(state, point.x, point.y, faction, undefined, true)) return false;
  const x = Math.floor(point.x), y = Math.floor(point.y), tile = tileAt(state.world, x, y);
  return tile?.terrain === 'river' && tile.overlay === 'ford' || buildingsAt(state, x, y).some(isRoute);
}

function terrainCanReceiveRoad(state: GameState, faction: number, x: number, y: number, occupants: readonly Building[], reservationsChecked = false): boolean {
  const tile = tileAt(state.world, x, y);
  if (!tile || WATER.has(tile.terrain) || tile.resource || tile.farm !== undefined
    || !ridgeFootprintAllowed(state.world, x, y) || !canWalk(state, x + .5, y + .5, faction, undefined, true)) return false;
  // Access roads preserve crops and trees. They do not demolish structures,
  // relocate farms, open new gates, or build new crossings over water.
  if (!reservationsChecked && (state.fields?.some(field => field.x === x && field.y === y)
    || buildingOverlapsVillageBorders(state, 'road', x, y, faction))) return false;
  return occupants.every(building => building.kind === 'irrigation' && building.faction === faction);
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

/** A read-only road search owns one terrain/occupancy snapshot. Reservations
 * are validated against the entire proposed corridor before anyone departs. */
export function resourceRoadJourney(state: GameState, city: Building, cells: readonly number[], _resource?: RegionalResource): ResourceRoadJourney | undefined {
  if (city.kind !== 'palace' || !buildingReady(city)) return;
  const valid = cells.filter(cell => Number.isSafeInteger(cell) && cell >= 0 && cell < state.world.tiles.length);
  const anchor = southernResourceCell(valid, state.world.width);
  if (anchor === undefined) return;
  return withNavigationFrame(state, () => {
    const { width, height } = state.world, faction = city.faction;
    const resourceCells = new Set(valid), occupants = new Map<number, Building[]>();
    for (const building of state.buildings) if (buildingPresent(building)) {
      for (let y = building.y; y < building.y + buildingHeight(building); y++) for (let x = building.x; x < building.x + buildingWidth(building); x++) {
        const cell = y * width + x, list = occupants.get(cell) ?? []; list.push(building); occupants.set(cell, list);
      }
    }
    const fieldCells = new Set(state.fields?.map(field => field.y * width + field.x));
    const villages = new Set(state.villages?.filter(village => !village.destroyed && village.faction !== faction).map(village => village.faction));
    const borders = villages.size ? territory(state) : undefined;
    const allowed = new Map<number, boolean>(), ready = new Set<number>();
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
    const usable = (cell: number): boolean => {
      const cached = allowed.get(cell); if (cached !== undefined) return cached;
      const x = cell % width, y = Math.floor(cell / width), tile = state.world.tiles[cell], structures = occupants.get(cell) ?? [];
      let okay = inside(x, y) && !!tile && canWalk(state, x + .5, y + .5, faction, undefined, true);
      if (okay && (structures.some(isRoute) || tile.terrain === 'river' && tile.overlay === 'ford')) ready.add(cell);
      else okay = okay && !resourceCells.has(cell) && !fieldCells.has(cell) && !villages.has(borders?.owners[cell] ?? -999)
        && terrainCanReceiveRoad(state, faction, x, y, structures, true);
      allowed.set(cell, okay); return okay;
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
    const network = createNetworkPlacementQuery(state);
    let remainingSearch = 12000;
    for (const goal of goals) {
      // Shared terrain components reject disconnected islands without spending
      // the bounded road search on thousands of unrelated mainland cells.
      if (!starts.some(start => hasStaticPath(state, center(state, start), center(state, goal), faction, true))) continue;
      const excluded = new Set<number>();
      for (let attempt = 0; attempt < 12 && remainingSearch > 0; attempt++) {
        const path = search(goal, excluded); if (!path) break;
        const additions: Building[] = []; let failed: number | undefined;
        for (const cell of path) {
          if (ready.has(cell)) continue;
          const x = cell % width, y = Math.floor(cell / width);
          if (!network('road', x, y, faction, additions).ok) { failed = cell; break; }
          additions.push({ id: -additions.length - 1, kind: 'road', faction, x, y, hp: 100, maxHp: 100, capacity: 0 });
        }
        if (failed !== undefined) { excluded.add(failed); continue; }
        const points = path.map(cell => center(state, cell));
        return { home: city.id, exit: points[0], goal: points[points.length - 1], path: points, roadCells: points.map(point => ({ ...point })) };
      }
    }
    function search(goal: number, excluded: ReadonlySet<number>): number[] | undefined {
      const gx = goal % width, gy = Math.floor(goal / width);
      const heuristic = (cell: number) => (Math.abs(cell % width - gx) + Math.abs(Math.floor(cell / width) - gy)) * .65;
      const queue = new TinyQueue<{cell:number; cost:number; score:number}>([], (a,b) => a.score - b.score || a.cell - b.cell);
      const costs = new Map<number, number>(), previous = new Map<number, number>();
      for (const cell of starts) if (!excluded.has(cell)) { costs.set(cell, 0); previous.set(cell, -1); queue.push({cell,cost:0,score:heuristic(cell)}); }
      while (queue.length && remainingSearch-- > 0) {
        const item = queue.pop()!; if (costs.get(item.cell) !== item.cost) continue;
        if (item.cell === goal) {
          const path:number[]=[];for(let cell=goal;cell!==-1;cell=previous.get(cell)!)path.push(cell);return path.reverse();
        }
        const x=item.cell%width,y=Math.floor(item.cell/width);
        for(const[dx,dy]of CARDINAL){
          const nx=x+dx,ny=y+dy,next=ny*width+nx;
          if(!inside(nx,ny)||excluded.has(next)||!usable(next)||!canTraverseEdge(state.world,{x,y},{x:nx,y:ny}))continue;
          const cost=item.cost+(ready.has(next)?.65:1);
          if(cost>=(costs.get(next)??Infinity))continue;
          costs.set(next,cost);previous.set(next,item.cell);queue.push({cell:next,cost,score:cost+heuristic(next)});
        }
      }
    }
  });
}

/** Empty or inaccessible settlements do not supply phantom road workers. */
export function planResourceRoad(state: GameState, faction: number, cells: readonly number[], resource?: RegionalResource): ResourceRoadJourney | undefined {
  if (state.gameOver || state.factions.find(owner => owner.id === faction)?.defeated) return;
  const valid = cells.filter(cell => Number.isSafeInteger(cell) && cell >= 0 && cell < state.world.tiles.length);
  const anchor = southernResourceCell(valid, state.world.width); if (anchor === undefined) return;
  const populations = civilianWorkforcePopulations(state), destination = center(state, anchor);
  const cities = state.buildings.filter(city => city.kind === 'palace' && city.faction === faction && buildingReady(city)
    && (populations.get(city.id) ?? 0) > 0).sort((a,b) => distance({x:a.x+buildingWidth(a)/2,y:a.y+buildingHeight(a)/2},destination)
      - distance({x:b.x+buildingWidth(b)/2,y:b.y+buildingHeight(b)/2},destination) || a.id-b.id);
  for(const city of cities){const result=resourceRoadJourney(state,city,valid,resource);if(result)return result;}
}
