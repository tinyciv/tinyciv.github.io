import { rustEngine } from './rust-engine';
import { tileAt, type ResourceWork, type RegionalResource, type Tile, type World } from './types';

// Enum encoding only; Rust owns obstacle and work-access policies.
const codes: Record<RegionalResource, number> = { clay: 1, copper: 2, iron: 3, gold: 4, stone: 5, salt: 6, olives: 7, fish: 8, marble: 9, peat: 10, grapes: 11, coal: 12 };
const codeCount = 13;
const policies = Uint8Array.from({ length: codeCount * 2 }, (_, index) =>
  rustEngine.resource_ground_policy(index % codeCount, Number(index >= codeCount)));
const phases: Record<ResourceWork['phase'], number> = { road: 0, outbound: 1, working: 2, returning: 3 };
export const resourceWorkAccess = (resource: RegionalResource, phase: ResourceWork['phase'], worker = true): boolean =>
  !!rustEngine.resource_work_access(codes[resource], phases[phase], Number(worker));
/** Native deposit policy; ore cells behind the front row are open ground. */
export const resourceBlocksGround = (tile: Pick<Tile, 'resource' | 'oreAnchor' | 'oreHeight'> | undefined,
  saltAccess = false, cell = -1, worldWidth = 0): boolean => {
  if (!tile?.resource) return false;
  const behindFront = tile.oreAnchor !== undefined && tile.oreHeight !== undefined && cell >= tile.oreAnchor && worldWidth > 0
    && cell < tile.oreAnchor + (tile.oreHeight - 1) * worldWidth;
  const policy = policies[codes[tile.resource] + (behindFront ? codeCount : 0)];
  return !!(policy & (saltAccess ? 1 : 3));
};

export function resourceFootprintBlocked(world: World, x: number, y: number, width = 1, height = width): boolean {
  return !!resourceFootprintError(world, x, y, width, height);
}

export function resourceFootprintError(world: World, x: number, y: number, width = 1, height = width): string | undefined {
  const startX = Math.floor(x), startY = Math.floor(y);
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
    const column = startX + dx, row = startY + dy;
    const tile = tileAt(world, column, row), cell = row * world.width + column;
    if (!resourceBlocksGround(tile, false, cell, world.width)) continue;
    if (tile?.resource === 'peat') return 'Peat beds block construction.';
    if (tile?.resource === 'grapes') return 'Grape vines block construction.';
    if (tile?.resource === 'coal') return 'Coal deposits block construction.';
    return resourceBlocksGround(tile, true, cell, world.width)
      ? 'Stone and ore deposits block construction.' : 'Salt pans block construction.';
  }
}
