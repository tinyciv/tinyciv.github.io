import { unitRespectsForbidden } from './forbidden-zones';
import { buildingBlockers, canMove, invalidateNavigation } from './pathfinding';
import { refreshIndexedUnit } from './spatial';
import { refreshFogUnit } from './fog';
import { unitCollisionRadius, unitObstructs } from './collisions';
import { militiaMovementLimits } from './guard-posts';
import { type Building, type GameState, type Point, buildingWidth, buildingHeight, isFarmKind } from './types';

/** Step occupants aside before a footprint becomes impassable. Used both when
 * construction starts and when canceling a gate's road would close its wall.
 * An enclosed occupant stays put; callers must keep the footprint open. */
export function clearBuildingFootprint(state: GameState, building: Building): boolean {
  const spanX = buildingWidth(building), spanY = buildingHeight(building), width = state.world.width;
  const onSite = (point: Point): boolean => point.x >= building.x && point.x < building.x + spanX
    && point.y >= building.y && point.y < building.y + spanY;
  const occupants = state.units.filter(unit => unit.hp > 0 && !unit.inside && onSite(unit));
  for (const unit of occupants) {
    // Birds evacuate through their own marsh-and-water movement. The ordinary
    // land search could relocate them onto upland; keep the site open until
    // their habitat-aware update has moved them clear.
    if (unit.kind === 'marshBird') continue;
    const blockers = buildingBlockers(state, unit.faction);
    for (let y = building.y; y < building.y + spanY; y++) for (let x = building.x; x < building.x + spanX; x++) blockers.delete(y * width + x);
    for (const cell of militiaMovementLimits(state, unit) ?? []) blockers.add(cell);
    const queue: Point[] = [{ x: Math.floor(unit.x) + .5, y: Math.floor(unit.y) + .5 }];
    const visited = new Set<number>([Math.floor(unit.y) * width + Math.floor(unit.x)]);
    let destination: Point | undefined;
    for (let head = 0; head < queue.length; head++) {
      const point = queue[head];
      if (!onSite(point) && !state.units.some(other => unitObstructs(unit, other)
        && Math.hypot(other.x - point.x, other.y - point.y) < unitCollisionRadius(unit) + unitCollisionRadius(other))) { destination = point; break; }
      const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]
        .map(([dx, dy]) => ({ x: point.x + dx, y: point.y + dy }))
        .sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y));
      for (const next of neighbors) {
        const key = Math.floor(next.y) * width + Math.floor(next.x);
        if (visited.has(key) || Math.hypot(next.x - unit.x, next.y - unit.y) > 6
          || !canMove(state, point, next, unit.faction, blockers, unitRespectsForbidden(state, unit))) continue;
        visited.add(key); queue.push(next);
      }
    }
    if (destination) {
      unit.x = destination.x; unit.y = destination.y;
      refreshIndexedUnit(state, unit);
      refreshFogUnit(state, unit);
      unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
    }
  }
  return !occupants.some(onSite);
}

/** Reserve buildings without trapping a unit that happened to stand on the site.
 * Only move through previously walkable cells; an enclosed occupant keeps the
 * site passable and delays work until there is somewhere to step aside. */
export function clearConstructionSite(state: GameState, building: Building): boolean {
  const site = building.construction;
  if (!site || site.cleared && !site.waitingForBuilder) return true;
  if (isFarmKind(building.kind) || ['road', 'bridge', 'irrigation'].includes(building.kind)) {
    site.cleared = true; return true;
  }
  const evacuating = !clearBuildingFootprint(state, building);
  if (!!site.evacuating !== evacuating) invalidateNavigation(state);
  site.evacuating = evacuating;
  site.cleared = !site.evacuating;
  return site.cleared;
}
