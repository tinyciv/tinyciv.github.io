import { canTraverseEdge, canWalk, traversable } from './pathfinding';
import { reliefFootprintAllowed, reliefLevel } from './relief';
import { navigableWaterCell } from './water-navigation';
import { isPolarSeaLane } from '../world/polar-sea';
import { galleyOverlapsTile } from './galley-footprint';
import { placementOccupancy } from './placement-occupancy';
import { buildingWidth, buildingHeight, isFarmKind, tileAt, WATER, type Building, type GameState, type Point } from './types';

/** Cardinal direction from the dry house cell toward its jetty. */
export type DockFacing = 0 | 1 | 2 | 3;
export const DOCK_DIRECTIONS: readonly Point[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
export { DOCK_COST, DOCK_HP, DOCK_BUILD_SECONDS } from './dock-config';

/** The house occupies one land tile; the jetty reserves the neighboring water
 * tile without turning that water into walkable land. */
export function dockBerth(building: Pick<Building, 'x' | 'y' | 'dockFacing'>): Point {
  const direction = DOCK_DIRECTIONS[building.dockFacing ?? 2];
  return { x: building.x + direction.x + .5, y: building.y + direction.y + .5 };
}

/** Two reserved cells, expressed relative to the dry anchor. Keeping that
 * anchor stable lets the same shore click rotate the water half automatically. */
export function dockFootprint(building: Pick<Building, 'dockFacing'>): { x: number; y: number; width: number; height: number } {
  const direction = DOCK_DIRECTIONS[building.dockFacing ?? 2];
  return { x: Math.min(0, direction.x), y: Math.min(0, direction.y),
    width: 1 + Math.abs(direction.x), height: 1 + Math.abs(direction.y) };
}

export function dockBerthOccupiedByFootprint(state: GameState, x: number, y: number, width = 1, height = 1): boolean {
  return placementOccupancy(state).berthBlocked(x, y, width, height);
}

/** Boarding crosses one clear shoreline edge. Diagonal transfers must clear
 * both flanking cells, just as walking and sailing cannot cut solid corners.
 * Include a proposed dock before its house and jetty enter the building list. */
export function dockShoreCrossingClear(state: GameState, water: Point, shore: Point,
  proposedDock?: Pick<Building, 'x' | 'y' | 'dockFacing'>): boolean {
  const occupancy = placementOccupancy(state);
  return shoreCrossingClear(state, water, shore, (cx, cy) => occupancy.berthBlocked(cx, cy, 1, 1)
    || occupancy.at(cx, cy).some(building => building.hp > 0 && building.kind !== 'road'
      && building.kind !== 'irrigation' && building.kind !== 'ruin' && !isFarmKind(building.kind)
      && cx >= building.x && cy >= building.y && cx < building.x + buildingWidth(building)
      && cy < building.y + buildingHeight(building)), proposedDock);
}

/** Snapshot occupancy once for a batch of shore candidates. The owning planner
 * discards this query when its terrain/building/border revision changes. */
export function createDockShoreCrossingQuery(state: GameState): (water: Point, shore: Point,
  proposedDock?: Pick<Building, 'x' | 'y' | 'dockFacing'>) => boolean {
  const occupied = new Set<number>(), { width, height } = state.world;
  const add = (x: number, y: number): void => {
    if (x >= 0 && y >= 0 && x < width && y < height) occupied.add(y * width + x);
  };
  for (const building of state.buildings) {
    if (!(building.hp > 0)) continue;
    if (building.kind === 'dock') {
      const berth = dockBerth(building); add(Math.floor(berth.x), Math.floor(berth.y));
    }
    if (building.kind === 'road' || building.kind === 'irrigation' || building.kind === 'ruin' || isFarmKind(building.kind)) continue;
    for (let y = Math.max(0, Math.ceil(building.y)); y < Math.min(height, building.y + buildingHeight(building)); y++)
      for (let x = Math.max(0, Math.ceil(building.x)); x < Math.min(width, building.x + buildingWidth(building)); x++) add(x, y);
  }
  const blocked = (x: number, y: number): boolean => occupied.has(y * width + x);
  return (water, shore, proposedDock) => shoreCrossingClear(state, water, shore, blocked, proposedDock);
}

function shoreCrossingClear(state: GameState, water: Point, shore: Point, occupied: (x: number, y: number) => boolean,
  proposedDock?: Pick<Building, 'x' | 'y' | 'dockFacing'>): boolean {
  if (!canTraverseEdge(state.world, water, shore)) return false;
  const x = Math.floor(water.x), y = Math.floor(water.y), sx = Math.floor(shore.x), sy = Math.floor(shore.y);
  const proposedBerth = proposedDock && dockBerth(proposedDock);
  const blocked = (cx: number, cy: number): boolean => {
    if (proposedDock && (cx === proposedDock.x && cy === proposedDock.y
      || cx === Math.floor(proposedBerth!.x) && cy === Math.floor(proposedBerth!.y))) return true;
    return occupied(cx, cy);
  };
  return !blocked(x, y) && !blocked(sx, sy)
    && (x === sx || y === sy || !blocked(sx, y) && !blocked(x, sy));
}

export interface DockPlacement { facing: DockFacing; berth: Point }
const waterOpen = (state: GameState, point: Point): boolean => {
  if (!navigableWaterCell(state.world, point.x, point.y)) return false;
  // Structures occupy whole integer cells, so the cell index answers the same
  // footprint test without scanning every building for each mooring point.
  const x = Math.floor(point.x), y = Math.floor(point.y), occupancy = placementOccupancy(state);
  return !occupancy.berthBlocked(x, y, 1, 1) && !occupancy.at(x, y).some(building => building.hp > 0);
};

/** Open water beside the jetty, paired with a dry boarding bank. The jetty
 * itself is reserved, so a boat never spawns through its planks or supports. */
export function dockMoorings(state: GameState, building: Pick<Building, 'x' | 'y' | 'dockFacing' | 'faction'>): Point[] {
  const berth = dockBerth(building), direction = DOCK_DIRECTIONS[building.dockFacing ?? 2];
  if (!navigableWaterCell(state.world, berth.x, berth.y)) return [];
  const offsets = [[-direction.y, direction.x], [direction.y, -direction.x], [direction.x, direction.y],
    [direction.x - direction.y, direction.y + direction.x], [direction.x + direction.y, direction.y - direction.x],
    [-direction.x - direction.y, -direction.y + direction.x], [-direction.x + direction.y, -direction.y - direction.x]];
  return offsets.map(([x, y]) => ({ x: berth.x + x, y: berth.y + y })).filter(point => waterOpen(state, point)
    && reliefLevel(tileAt(state.world, point.x, point.y)) === reliefLevel(tileAt(state.world, berth.x, berth.y))
    && [-1, 0, 1].some(dy => [-1, 0, 1].some(dx => {
      if (!dx && !dy) return false;
      const land = { x: point.x + dx, y: point.y + dy }, tile = tileAt(state.world, land.x, land.y);
      if (Math.floor(land.x) === building.x && Math.floor(land.y) === building.y) return false;
      return !!tile && !WATER.has(tile.terrain) && reliefLevel(tile) === reliefLevel(tileAt(state.world, point.x, point.y))
        && canWalk(state, land.x, land.y, building.faction) && dockShoreCrossingClear(state, point, land, building);
    })));
}

/** Deterministic automatic orientation. Prefer south to match the reviewed
 * art, then east, north and west; never reserve a bridge or other jetty. */
export function dockPlacement(state: GameState, x: number, y: number, faction = 0,
  acceptsBerth?: (berth: Point) => boolean): DockPlacement | undefined {
  x = Math.floor(x); y = Math.floor(y);
  const land = tileAt(state.world, x, y);
  if (!land || WATER.has(land.terrain) || land.marsh || !traversable(state.world, x, y)
    || !reliefFootprintAllowed(state.world, x, y) || dockBerthOccupiedByFootprint(state, x, y)) return;
  // Keep a dry approach for builders and for the Leader to board. The ordinary
  // construction validator also verifies the route from a settlement.
  if (!DOCK_DIRECTIONS.some(direction => {
    const point = { x: x + direction.x + .5, y: y + direction.y + .5 }, tile = tileAt(state.world, point.x, point.y);
    return tile && !WATER.has(tile.terrain) && canWalk(state, point.x, point.y, faction);
  })) return;
  for (const facing of [2, 1, 0, 3] as const) {
    const berth = dockBerth({ x, y, dockFacing: facing }), water = tileAt(state.world, berth.x, berth.y);
    if (acceptsBerth && !acceptsBerth(berth)) continue;
    if ((state.world.generationStyle || state.world.scenario) && isPolarSeaLane(berth.y, state.world.height)) continue;
    if (!water || !navigableWaterCell(state.world, berth.x, berth.y) || reliefLevel(water) !== reliefLevel(land)
      || dockBerthOccupiedByFootprint(state, Math.floor(berth.x), Math.floor(berth.y))) continue;
    if (state.buildings.some(building => building.hp > 0 && berth.x >= building.x && berth.y >= building.y
      && berth.x < building.x + buildingWidth(building) && berth.y < building.y + buildingHeight(building))) continue;
    if (state.units.some(unit => unit.hp > 0 && !unit.inside && (unit.kind === 'sailboat'
      ? galleyOverlapsTile(unit, Math.floor(berth.x), Math.floor(berth.y))
      : Math.floor(unit.x) === Math.floor(berth.x) && Math.floor(unit.y) === Math.floor(berth.y)))) continue;
    if (!dockMoorings(state, { x, y, dockFacing: facing, faction }).length) continue;
    return { facing, berth };
  }
}
