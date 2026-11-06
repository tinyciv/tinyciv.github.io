import { refundGold } from './gold-ledger';
import { cancellationRefund, removeBuildings } from './construction-cancellation';
import { type Building, type GameState, buildingWidth, buildingHeight, isFarmKind, isWallKind } from './types';

/** Enemy infrastructure is still occupied land; only our roads and neutral
 * footpaths can be replaced by a building order. Gates retain both layers. */
export function replaceableRoad(road: Building, faction: number): boolean {
  return road.hp > 0 && road.kind === 'road' && (road.faction === faction || road.faction === -1);
}

/** Queued sites retain their usable roads until a builder actually starts work.
 * Walkable farms keep their road underlay throughout construction and growth. */
export function removeCoveredRoads(state: GameState, building: Building): void {
  if (isWallKind(building.kind) || isFarmKind(building.kind) || ['road', 'bridge', 'irrigation', 'ruin'].includes(building.kind)) return;
  const width = buildingWidth(building), height = buildingHeight(building);
  const left = building.x, top = building.y;
  const roads = state.buildings.filter(road => replaceableRoad(road, building.faction)
    && road.x >= left && road.x < left + width && road.y >= top && road.y < top + height);
  if (!roads.length) return;
  for (const road of roads) {
    if (road.construction) {
      const owner = state.factions.find(faction => faction.id === road.faction);
      if (owner) refundGold(state, owner, cancellationRefund(state, road));
    }
    delete state.traffic?.[String(road.y * state.world.width + road.x)];
  }
  removeBuildings(state, new Set(roads.map(road => road.id)));
}
