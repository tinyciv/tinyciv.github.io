import { buildingArtTop, buildingWidth, buildingHeight, buildingReady, type Building, type GameState, type Point, type Unit } from './types';
import { entityVisible } from './fog';
import { HOUSE_WELL_BOUNDS, HOUSE_WELL_OFFSET, sharedHouseForWell } from './house-wells';
import { sharedWallForTower, sharedTowerForWall } from './wall-towers';
import { irrigationChannelDistance, irrigationConnections } from './irrigation-art';
import { dockArtBounds, dockConstructionBounds } from './naval-art';
import { galleyContainsPoint } from './galley-footprint';

/** Match upright figures above their footing and the full oriented galley hull.
 * This affects pointing only; physical boat clearance uses the same hull geometry. */
export function unitAtPoint(state: GameState, point: Point): Unit | undefined {
  return state.units.filter(unit => {
    if (unit.hp <= 0 || unit.inside || !entityVisible(state, unit)) return false;
    if (unit.kind === 'sailboat') return galleyContainsPoint(unit, point, .06);
    const boat = unit.aboardRiverTrade;
    const dx = (point.x - unit.x) / (boat ? .5 : .46);
    const dy = (point.y - (unit.y - (boat ? 0 : .35))) / .6;
    return dx * dx + dy * dy <= 1;
  // When figures overlap, the southern figure is drawn on top.
  }).sort((a, b) => b.y - a.y || Math.abs(a.x - point.x) - Math.abs(b.x - point.x))[0];
}

/** Every visible member or structure of a peaceful village is a diplomatic
 * entry point. Units win overlaps, matching ordinary selection. */
export function neutralVillageEntityAt(state: GameState, point: Point): Building | Unit | undefined {
  if (state.gameOver) return;
  const entity = unitAtPoint(state, point) ?? buildingAtPoint(state, point);
  if (!entity || entity.villageId === undefined) return;
  const village = state.villages?.find(village => village.id === entity.villageId);
  return village && !village.destroyed && village.relation !== 'war'
    && state.buildings.some(building => building.id === village.campId && buildingReady(building)) ? entity : undefined;
}

/** Select the visible frontmost structure, including its upper-storey art.
 * Callers check units first; this never changes physical occupancy or sight. */
export function buildingAtPoint(state: GameState, point: Point): Building | undefined {
  // A ditch shares a farm's plot, but only its narrow visible channel should
  // select irrigation. Clicking the grain still opens the farm's activities.
  for (const ditch of state.buildings) {
    if (ditch.kind !== 'irrigation' || ditch.hp <= 0 || !entityVisible(state, ditch)
      || Math.floor(point.x) !== ditch.x || Math.floor(point.y) !== ditch.y) continue;
    if (ditch.construction) return ditch;
    const links = irrigationConnections(ditch, (x, y) => state.buildings.filter(other => other.x === x && other.y === y && entityVisible(state, other)), state.world);
    if (irrigationChannelDistance(links, (point.x - ditch.x) * 16, (point.y - ditch.y) * 16) > 2.7) continue;
    const road = state.buildings.find(other => other.kind === 'road' && other.x === ditch.x && other.y === ditch.y && buildingReady(other) && entityVisible(state, other));
    if (road && Math.abs(point.x - ditch.x - .5) < .25 && Math.abs(point.y - ditch.y - .5) < .25) return road;
    return ditch;
  }
  let selected: Building | undefined, frontDepth = -Infinity;
  for (const building of state.buildings) {
    if (building.hp <= 0 && !(building.kind === 'fort' && building.fort?.destroyed) || !building.construction && (building.kind === 'road' || building.kind === 'bridge' || building.kind === 'irrigation') || !entityVisible(state, building)) continue;
    // Every structure uses its top-left footprint, including two-cell farms.
    const width = buildingWidth(building), height = buildingHeight(building), x = building.x, y = building.y;
    const attachedWell = !!sharedHouseForWell(building, state.buildings);
    const mountedTower = !!sharedWallForTower(building, state.buildings);
    const towerOnWall = sharedTowerForWall(building, state.buildings);
    const depth = y + height + (attachedWell ? HOUSE_WELL_OFFSET.y : mountedTower ? 1 / 64 : 0);
    // The attached well has its own visible hit area, including its small
    // overhang. The house entrance and right side still select the house.
    const dockBounds = building.kind === 'dock' ? building.construction ? dockConstructionBounds(building) : dockArtBounds(building) : undefined;
    const bounds = dockBounds ? { left: dockBounds.x / 32, top: dockBounds.y / 32,
      right: (dockBounds.x + dockBounds.width) / 32, bottom: (dockBounds.y + dockBounds.height) / 32 }
      : attachedWell ? HOUSE_WELL_BOUNDS
      : mountedTower ? { left: 0, top: buildingArtTop(building), right: 1, bottom: building.construction ? .5 : .25 }
      : towerOnWall ? { left: 0, top: towerOnWall.construction ? .5 : .25, right: 1, bottom: 1 }
      : { left: 0, top: buildingArtTop(building), right: width, bottom: height };
    if (point.x < x + bounds.left || point.x >= x + bounds.right
      || point.y < y + bounds.top || point.y >= y + bounds.bottom) continue;
    // Renderer uses stable ascending depth: later entries win an equal depth.
    // At a gate, keep a new road or wall order selectable over its finished layer.
    if (depth > frontDepth || depth === frontDepth && (!selected?.construction || !!building.construction)) { selected = building; frontDepth = depth; }
  }
  return selected;
}
