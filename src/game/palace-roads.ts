import { isForbidden } from './forbidden-zones';
import { removeVillageTrailAt } from './village-trails';
import { buildingOverlapsVillageBorders } from './border-placement';
import { markWorldChanged } from './world-revisions';
import { entityStore } from './entity-store';
import { invalidateNavigation, traversable } from './pathfinding';
import { ridgeFootprintAllowed } from './ridges';
import { farmAt, planRoadFarmRelocation, relocateFarm } from './farm-relocation';
import { buildingReady, buildingSize, buildingWidth, buildingHeight, isFarmKind, isWallKind, tileAt, WATER, type Building, type GameState } from './types';

/** A completed city receives its own free perimeter road. Occupied or natural
 * obstacles leave gaps; existing infrastructure and crops retain their owners. */
export function addPalaceRoadRing(state: GameState, palace: Building): number {
  if (palace.kind !== 'palace' || !buildingReady(palace)) return 0;
  const size = buildingSize(palace);
  const ring = new Set<number>();
  for (let y = palace.y - 1; y <= palace.y + size; y++) for (let x = palace.x - 1; x <= palace.x + size; x++)
    if (x === palace.x - 1 || x === palace.x + size || y === palace.y - 1 || y === palace.y + size) ring.add(y * state.world.width + x);
  let id = 0, added = 0, removedPalm = false, removedTrail = false;
  const changed: number[] = [];
  for (const entity of state.units) id = Math.max(id, entity.id);
  for (const entity of state.buildings) id = Math.max(id, entity.id);
  for (let y = palace.y - 1; y <= palace.y + size; y++) for (let x = palace.x - 1; x <= palace.x + size; x++) {
    if (x !== palace.x - 1 && x !== palace.x + size && y !== palace.y - 1 && y !== palace.y + size) continue;
    if (buildingOverlapsVillageBorders(state, 'road', x, y, palace.faction)) continue;
    const tile = tileAt(state.world, x, y);
    if (!tile || isForbidden(state, x, y, palace.faction) || WATER.has(tile.terrain) || !traversable(state.world, x, y) || !ridgeFootprintAllowed(state.world, x, y)) continue;
    if (state.buildings.some(building => {
      if (building.hp <= 0 || x < building.x || y < building.y
        || x >= building.x + buildingWidth(building) || y >= building.y + buildingHeight(building)) return false;
      // Friendly crops may move aside; friendly/neutral walls become gates.
      return !(isFarmKind(building.kind) && building.faction === palace.faction
        || isWallKind(building.kind) && (building.faction === palace.faction || building.faction === -1));
    })) continue;
    if (state.fields?.some(field => field.x === x && field.y === y && field.faction !== palace.faction)) continue;
    const farm = farmAt(state, { x, y }, palace.faction);
    if (farm) {
      const plan = planRoadFarmRelocation(state, { x, y }, palace.faction, ring);
      if (!plan || !relocateFarm(state, plan, { x, y }, { wall: true, road: true, reservedTiles: ring })) continue;
    }
    if (state.fields?.some(field => field.x === x && field.y === y)) continue;
    entityStore(state).buildings.add({ id: ++id, kind: 'road', faction: palace.faction, x, y,
      hp: 100, maxHp: 100, capacity: 0, armor: 2 });
    const palm = !!tile.palm, trail = removeVillageTrailAt(state.world, x, y);
    removedPalm ||= palm; removedTrail ||= trail; delete tile.palm;
    if (palm || trail) changed.push(y * state.world.width + x);
    added++;
  }
  if (added) {
    markWorldChanged(state.world, removedPalm || removedTrail ? 'appearance' : 'structure', changed);
    invalidateNavigation(state);
  }
  return added;
}
