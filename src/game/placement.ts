import { playerFaction } from './player-context';
import { buildingWidth, buildingHeight, isFarmKind, isWallKind, type Building, type BuildingKind, type GameState, type Point } from './types';
import { constructionEdges } from './builders';
import { staticReachabilityMask } from './pathfinding';
import { CAMP_CENTER_SPACING, isCamp } from './camp-spacing';
import { canShareHouseWellTile } from './house-wells';

/** Reachability starts outside the palace's blocked footprint. Reuse static
 * components rather than calculating travel costs for every candidate cell. */
export function palaceReachability(state: GameState, palace: Building): Uint8Array {
  return staticReachabilityMask(state, constructionEdges(state, palace, true), palace.faction, true);
}

/** Farms may touch; only the same crop cell conflicts. */
export function campSpacingAllowed(state: GameState, x: number, y: number): boolean {
  return !state.buildings.some(building => isCamp(building)
    && Math.abs(building.x - x) < CAMP_CENTER_SPACING && Math.abs(building.y - y) < CAMP_CENTER_SPACING);
}

/** Palaces have no special setback. Callers still check occupied footprints,
 * farm enclosures, residential lanes and reachability normally. */
export function palaceSpacingAllowed(_state: GameState, _kind: BuildingKind, _x: number, _y: number): boolean {
  return true;
}

/** Solid buildings preserve residential lanes; defensive walls may directly border a block. */
export function residentialClearanceAllowed(state: GameState, kind: BuildingKind, x: number, y: number, faction = playerFaction(state)): boolean {
  if (kind === 'road' || kind === 'bridge' || kind === 'irrigation' || kind === 'house' || isFarmKind(kind) || isWallKind(kind)) return true;
  // A well sharing a home's reserved cell adds no obstacle to the block's
  // surrounding walking lane, even when that home touches other homes.
  if (kind === 'well' && state.buildings.some(house => house.hp > 0 && canShareHouseWellTile({ kind, x, y, faction }, house))) return true;
  const left = x, top = y, width = buildingWidth({ kind }), height = buildingHeight({ kind });
  return state.buildings.every(house => {
    if (house.kind !== 'house' || house.hp <= 0) return true;
    const gapX = Math.max(house.x - (left + width), left - (house.x + 1), 0);
    const gapY = Math.max(house.y - (top + height), top - (house.y + 1), 0);
    return Math.max(gapX, gapY) >= 1;
  });
}

/** A small preference for settlement rows; never a substitute for site validation.
 * Align centers for equal footprints, or exterior edges for different sizes. */
export function buildingAlignmentBonus(state: GameState, faction: number, x: number, y: number, width = 1, height = width): number {
  let horizontal = false, vertical = false;
  for (const building of state.buildings) {
    if (building.hp <= 0 || building.faction !== faction || ['road', 'wall', 'palisade', 'bridge', 'irrigation', 'ruin'].includes(building.kind)) continue;
    const otherWidth = buildingWidth(building), otherHeight = buildingHeight(building);
    horizontal ||= y + height / 2 === building.y + otherHeight / 2 || y === building.y || y + height === building.y + otherHeight;
    vertical ||= x + width / 2 === building.x + otherWidth / 2 || x === building.x || x + width === building.x + otherWidth;
    if (horizontal && vertical) break;
  }
  return Number(horizontal) * .2 + Number(vertical) * .2;
}

/** Reuse row/column alignment for a synchronous search over many candidate sites. */
export function buildingAlignmentQuery(state: GameState, faction: number, width = 1, height = width): (x: number, y: number) => number {
  const rows = new Set<number>(), columns = new Set<number>();
  for (const building of state.buildings) {
    if (building.hp <= 0 || building.faction !== faction || ['road', 'wall', 'palisade', 'bridge', 'irrigation', 'ruin'].includes(building.kind)) continue;
    const otherWidth = buildingWidth(building), otherHeight = buildingHeight(building);
    rows.add(building.y + (otherHeight - height) / 2); rows.add(building.y); rows.add(building.y + otherHeight - height);
    columns.add(building.x + (otherWidth - width) / 2); columns.add(building.x); columns.add(building.x + otherWidth - width);
  }
  return (x, y) => Number(rows.has(y)) * .2 + Number(columns.has(x)) * .2;
}
