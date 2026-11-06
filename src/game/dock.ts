import { canTraverseEdge, canWalk, traversable } from './pathfinding';
import { ridgeFootprintAllowed, ridgeLevel } from './ridges';
import { navigableWaterCell } from './water-navigation';
import { buildingWidth, buildingHeight, isFarmKind, tileAt, WATER, type Building, type GameState, type Point } from './types';

/** Cardinal direction from the dry house cell toward its jetty. */
export type DockFacing = 0 | 1 | 2 | 3;
export const DOCK_DIRECTIONS: readonly Point[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
export const DOCK_COST = 100;
export const DOCK_HP = 250;
export const DOCK_BUILD_SECONDS = 30;

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
  return state.buildings.some(building => {
    if (building.kind !== 'dock' || building.hp <= 0) return false;
    const berth = dockBerth(building);
    return berth.x >= x && berth.y >= y && berth.x < x + width && berth.y < y + height;
  });
}

/** Boarding crosses one clear shoreline edge. Diagonal transfers must clear
 * both flanking cells, just as walking and sailing cannot cut solid corners.
 * Include a proposed dock before its house and jetty enter the building list. */
export function dockShoreCrossingClear(state: GameState, water: Point, shore: Point,
  proposedDock?: Pick<Building, 'x' | 'y' | 'dockFacing'>): boolean {
  if (!canTraverseEdge(state.world, water, shore)) return false;
  const x = Math.floor(water.x), y = Math.floor(water.y), sx = Math.floor(shore.x), sy = Math.floor(shore.y);
  const proposedBerth = proposedDock && dockBerth(proposedDock);
  const blocked = (cx: number, cy: number): boolean => {
    if (proposedDock && (cx === proposedDock.x && cy === proposedDock.y
      || cx === Math.floor(proposedBerth!.x) && cy === Math.floor(proposedBerth!.y))) return true;
    if (dockBerthOccupiedByFootprint(state, cx, cy)) return true;
    return state.buildings.some(building => building.hp > 0 && building.kind !== 'road'
      && building.kind !== 'irrigation' && building.kind !== 'ruin' && !isFarmKind(building.kind)
      && cx >= building.x && cy >= building.y && cx < building.x + buildingWidth(building)
      && cy < building.y + buildingHeight(building));
  };
  return !blocked(x, y) && !blocked(sx, sy)
    && (x === sx || y === sy || !blocked(sx, y) && !blocked(x, sy));
}

export interface DockPlacement { facing: DockFacing; berth: Point }
const waterOpen = (state: GameState, point: Point): boolean => {
  return navigableWaterCell(state.world, point.x, point.y)
    && !dockBerthOccupiedByFootprint(state, Math.floor(point.x), Math.floor(point.y))
    && !state.buildings.some(building => building.hp > 0 && point.x >= building.x && point.y >= building.y
      && point.x < building.x + buildingWidth(building) && point.y < building.y + buildingHeight(building));
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
    && ridgeLevel(tileAt(state.world, point.x, point.y)) === ridgeLevel(tileAt(state.world, berth.x, berth.y))
    && [-1, 0, 1].some(dy => [-1, 0, 1].some(dx => {
      if (!dx && !dy) return false;
      const land = { x: point.x + dx, y: point.y + dy }, tile = tileAt(state.world, land.x, land.y);
      if (Math.floor(land.x) === building.x && Math.floor(land.y) === building.y) return false;
      return !!tile && !WATER.has(tile.terrain) && ridgeLevel(tile) === ridgeLevel(tileAt(state.world, point.x, point.y))
        && canWalk(state, land.x, land.y, building.faction) && dockShoreCrossingClear(state, point, land, building);
    })));
}

/** Deterministic automatic orientation. Prefer south to match the reviewed
 * art, then east, north and west; never reserve a bridge, ford or other jetty. */
export function dockPlacement(state: GameState, x: number, y: number, faction = 0): DockPlacement | undefined {
  x = Math.floor(x); y = Math.floor(y);
  const land = tileAt(state.world, x, y);
  if (!land || WATER.has(land.terrain) || land.marsh || !traversable(state.world, x, y)
    || !ridgeFootprintAllowed(state.world, x, y) || dockBerthOccupiedByFootprint(state, x, y)) return;
  // Keep a dry approach for builders and for the Leader to board. The ordinary
  // construction validator also verifies the route from a settlement.
  if (!DOCK_DIRECTIONS.some(direction => {
    const point = { x: x + direction.x + .5, y: y + direction.y + .5 }, tile = tileAt(state.world, point.x, point.y);
    return tile && !WATER.has(tile.terrain) && canWalk(state, point.x, point.y, faction);
  })) return;
  for (const facing of [2, 1, 0, 3] as const) {
    const berth = dockBerth({ x, y, dockFacing: facing }), water = tileAt(state.world, berth.x, berth.y);
    if (!water || !navigableWaterCell(state.world, berth.x, berth.y) || ridgeLevel(water) !== ridgeLevel(land)
      || dockBerthOccupiedByFootprint(state, Math.floor(berth.x), Math.floor(berth.y))) continue;
    if (state.buildings.some(building => building.hp > 0 && berth.x >= building.x && berth.y >= building.y
      && berth.x < building.x + buildingWidth(building) && berth.y < building.y + buildingHeight(building))) continue;
    if (state.units.some(unit => unit.hp > 0 && !unit.inside && Math.floor(unit.x) === Math.floor(berth.x) && Math.floor(unit.y) === Math.floor(berth.y))) continue;
    if (!dockMoorings(state, { x, y, dockFacing: facing, faction }).length) continue;
    return { facing, berth };
  }
}
