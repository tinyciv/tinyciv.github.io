import { villageRelationView } from './settlement-bridge';
import { playerFaction } from './player-context';
import { buildingArtTop, buildingWidth, buildingHeight, buildingReady, constructionSiteHidden, type Building, type GameState, type Point, type Unit } from './types';
import { entityVisible, pointExplored, presentationFog } from './fog';
import { HOUSE_WELL_BOUNDS, HOUSE_WELL_OFFSET, sharedHouseForWell } from './house-wells';
import { sharedWallForTower, sharedTowerForWall } from './wall-towers';
import { irrigationConnections, irrigationLayout, irrigationLayoutDistance } from './irrigation-art';
import { roadConnections, roadCoversPixel } from './road-sprites';
import { placementOccupancy } from './placement-occupancy';
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
  return village && !village.destroyed && villageRelationView(state, village, playerFaction(state)) !== 'war'
    && state.buildings.some(building => building.id === village.campId && buildingReady(building)) ? entity : undefined;
}

/** Select the visible frontmost structure, including its upper-storey art.
 * Callers check units first; this never changes physical occupancy or sight. */
export function buildingAtPoint(state: GameState, point: Point): Building | undefined {
  const tileX = Math.floor(point.x), tileY = Math.floor(point.y);
  const occupancy = placementOccupancy(state);
  const occupants = (x: number, y: number) => occupancy.at(x, y).filter(other => other.hp > 0 && entityVisible(state, other));
  const local = occupants(tileX, tileY);
  const ditch = local.find(b => b.kind === 'irrigation');
  if (ditch) {
    if (ditch.construction) return ditch;
    const x = (point.x - tileX) * 16, y = (point.y - tileY) * 16;
    const road = local.find(b => b.kind === 'road' && buildingReady(b));
    if (road && roadCoversPixel(roadConnections(road, occupants, state.world), road, Math.floor(x * 2), Math.floor(y * 2))) return road;
    const fog = presentationFog(state);
    const links = irrigationConnections(ditch, occupants, state.world, (x, y) => pointExplored(fog, x, y));
    const layout = irrigationLayout(ditch, links, occupants);
    // The exposed channel selects the ditch and the surrounding grain still
    // opens the farm's activities.
    if (irrigationLayoutDistance(layout, x, y) <= 2.7) return ditch;
  }
  let selected: Building | undefined, frontDepth = -Infinity;
  for (const building of state.buildings) {
    if (constructionSiteHidden(building)) continue;
    if (building.hp <= 0 && !(building.kind === 'fort' && building.fort?.destroyed) || !building.construction && (building.kind === 'road' || building.kind === 'bridge' || building.kind === 'irrigation') || !entityVisible(state, building)) continue;
    // Every structure uses its top-left footprint, including two-cell farms.
    const width = buildingWidth(building), height = buildingHeight(building), x = building.x, y = building.y;
    // Every hit area (dock jetties, well overhangs, tower tops) lies within one
    // tile of the footprint. Reject distant structures before the shared-tile
    // lookups below, which each scan every building: a click was O(n²).
    if (point.x < x - 1 || point.x >= x + Math.max(width, 2) + 1 || point.y < y - 1 || point.y >= y + Math.max(height, 2) + 1) continue;
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
