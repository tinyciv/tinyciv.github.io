import { buildingSize, type Building, type World } from './types';
import { terrainYields } from '../world/generator';
import { markWorldChanged } from './world-revisions';

/** Keep a five-tile woodland clearing around the entire palace footprint. */
export function clearPalaceWoodland(world: World, palace: Building): void {
  const size = buildingSize(palace);
  const changed: number[] = [];
  for (let y = Math.max(0, palace.y - 5); y < Math.min(world.height, palace.y + size + 5); y++)
    for (let x = Math.max(0, palace.x - 5); x < Math.min(world.width, palace.x + size + 5); x++) {
      const dx = Math.max(palace.x - x - .5, 0, x + .5 - palace.x - size);
      const dy = Math.max(palace.y - y - .5, 0, y + .5 - palace.y - size);
      const tile = world.tiles[y * world.width + x];
      if (Math.hypot(dx, dy) > 5 || !['forest', 'jungle'].includes(tile.overlay)) continue;
      const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields(tile.terrain, 'none');
      tile.overlay = 'none';
      for (const resource of ['food', 'production', 'gold'] as const)
        tile[resource] = Math.max(0, tile[resource] - before[resource] + after[resource]);
      changed.push(y * world.width + x);
    }
  if (changed.length) markWorldChanged(world, 'sight', changed);
}
