import { buildingHeight, buildingWidth, tileAt, type Building, type World } from './types';
import { terrainYields } from '../world/generator';
import { markWorldChanged } from './world-revisions';

/** A committed footprint clears its trees and updates the underlying yields. */
export function clearBuildingVegetation(world: World, building: Pick<Building, 'hp' | 'kind' | 'x' | 'y'>): void {
  if (building.hp <= 0) return;
  let changed: number[] | undefined, sightChanged = false;
  const width = buildingWidth(building), height = buildingHeight(building);
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
    const x = building.x + dx, y = building.y + dy, tile = tileAt(world, x, y);
    if (!tile) continue;
    const clearMarsh = building.kind !== 'irrigation' && !!tile.marsh;
    const clearCover = tile.overlay === 'forest' || tile.overlay === 'jungle'
      || building.kind !== 'irrigation' && tile.overlay === 'swamp';
    if (!tile.palm && !clearMarsh && !clearCover) continue;
    delete tile.palm;
    if (clearMarsh) delete tile.marsh;
    if (clearCover) {
      const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields(tile.terrain, 'none');
      tile.overlay = 'none'; sightChanged = true;
      for (const resource of ['food', 'production', 'gold'] as const)
        tile[resource] = Math.max(0, tile[resource] - before[resource] + after[resource]);
    }
    (changed ??= []).push(y * world.width + x);
  }
  if (changed) markWorldChanged(world, sightChanged ? 'sight' : 'appearance', changed);
}
