import { resourceFootprintError } from './resource-terrain';
import { placementOccupancy } from './placement-occupancy';
import { dockPlacement } from './dock';
import { isForbidden } from './forbidden-zones';
import { reliefFootprintAllowed } from './relief';
import { settlementFootprintAllowed, SETTLEMENT_MOUNTAIN_GAP } from './terrain-sites';
import { traversable } from './pathfinding';
import { thermalBathSiteError } from './thermal-baths-native';
import { canShareHouseWellTile } from './house-wells';
import { isPendingCampField } from './farms';
import { scenarioPlacementError } from './scenario-access-native';
import { buildingHeight, buildingWidth, isFord, isWallKind, tileAt, WATER, type BuildingKind, type GameState } from './types';

/** 0 ok, 1 blocked (occupied), 2 transient (a unit stands on it), 3 territory,
 * 4 unreachable, 5 terrain (water, relief, deposits, forbidden ground). */
export type PhysicalReason = 0 | 1 | 2 | 3 | 4 | 5;
export interface PhysicalResult { ok: boolean; reason: PhysicalReason; message: string; ford?: boolean }
const ok: PhysicalResult = { ok: true, reason: 0, message: '' };
const fail = (reason: PhysicalReason, message: string): PhysicalResult => ({ ok: false, reason, message });

/** Faction-independent footprint rules shared with player placement: deposits,
 * dock berths and shores, forbidden zones, permanent forts, hermits, fords,
 * relief exclusions, dry land, structure layering (house + well), fields and units.
 * Faction-only rules (leader reach, borders, research, cost) stay in
 * validateBuildCellAt. `ignore` lists buildings that the same effect removes. */
export function validatePhysicalFootprint(state: GameState, kind: BuildingKind, x: number, y: number, faction: number,
  options: { ignore?: ReadonlySet<number>; units?: boolean } = {}): PhysicalResult {
  const width = buildingWidth({ kind }), height = buildingHeight({ kind }), world = state.world;
  if (x < 0 || y < 0 || x + width > world.width || y + height > world.height) return fail(5, 'Outside the map.');
  if (kind === 'thermalBath') { const error = thermalBathSiteError(state, faction, { x, y }); if (error) return fail(5, error); }
  const resourceError = resourceFootprintError(world, x, y, width, height);
  if (resourceError) return fail(5, resourceError);
  if (kind === 'road' && width === 1 && isFord(tileAt(world, x, y))) return { ...ok, ford: true };
  const occupancy = placementOccupancy(state);
  if (occupancy.berthBlocked(x, y, width, height)) return fail(1, 'Leave the dock jetty clear.');
  if (kind === 'dock' && !dockPlacement(state, x, y, faction)) return fail(5, 'A dock needs a low shore with clear water beside it.');
  if (occupancy.permanentFortOverlaps(x, y, width, height)) return fail(1, 'This Fort foundation is permanent.');
  if (state.hermits?.some(h => x < h.x + (h.status === 'gone' ? 1 : 2) && x + width > h.x && y < h.y + (h.status === 'gone' ? 1 : 2) && y + height > h.y))
    return fail(1, 'Leave the hermit and their cabin undisturbed.');
  if (!reliefFootprintAllowed(world, x, y, width, height, isWallKind(kind)))
    return fail(5, isWallKind(kind) ? 'Walls require pathable ground.' : 'Hills and mountains cannot be built on.');
  if (kind === 'palace' && !settlementFootprintAllowed(world, x, y, width, height))
    return fail(5, `Place towns at least ${SETTLEMENT_MOUNTAIN_GAP} tiles from mountains.`);
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
    const cx = x + dx, cy = y + dy, tile = tileAt(world, cx, cy);
    if (!tile || kind !== 'dock' && kind !== 'thermalBath' && (!traversable(world, cx, cy) || WATER.has(tile.terrain))) return fail(5, 'Build on dry land.');
    if (isForbidden(state, cx, cy, faction)) return fail(5, 'Forbidden ground.');
    if (state.fields?.some(field => field.x === cx && field.y === cy) || isPendingCampField(state, cx, cy)) return fail(1, 'Keep this field open.');
    for (const building of occupancy.at(cx, cy)) {
      if (building.hp <= 0 || options.ignore?.has(building.id)) continue;
      if (canShareHouseWellTile({ kind, faction, x: cx, y: cy }, building)) continue;
      return fail(1, 'Tile occupied.');
    }
    if (options.units !== false && kind !== 'road' && state.units.some(unit => unit.hp > 0 && !unit.inside && Math.floor(unit.x) === cx && Math.floor(unit.y) === cy))
      return fail(2, 'Someone is standing here.');
  }
  const accessError = scenarioPlacementError(state,kind,x,y);
  return accessError ? fail(4,accessError) : ok;
}
