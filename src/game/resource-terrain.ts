import { rustEngine } from './rust-engine';
import { tileAt, type ResourceWork, type RegionalResource, type Tile, type World } from './types';

// Enum encoding only; Rust owns obstacle and work-access policies.
const codes: Record<RegionalResource, number> = { clay: 1, copper: 2, iron: 3, gold: 4, stone: 5, salt: 6, olives: 7, fish: 8 };
const policies = Uint8Array.from({ length: 9 }, (_, code) => rustEngine.resource_ground_policy(code));
const tallOrePolicies = Uint8Array.from({ length: 3 }, (_, row) => rustEngine.resource_ground_policy(2, 3, 3, row));
const phases: Record<ResourceWork['phase'], number> = { road: 0, outbound: 1, working: 2, returning: 3 };
export const resourceWorkAccess = (resource: RegionalResource, phase: ResourceWork['phase'], worker = true): boolean =>
  !!rustEngine.resource_work_access(codes[resource], phases[phase], Number(worker));
/** Native deposit policy; callers without cell geometry reserve the full artwork. */
export const resourceBlocksGround = (tile: Pick<Tile, 'resource' | 'oreAnchor' | 'oreWidth' | 'oreHeight'> | undefined,
  saltAccess = false, cell = -1, worldWidth = 0): boolean => {
  const code = tile?.resource ? codes[tile.resource] : 0;
  const row = tile?.oreAnchor !== undefined && cell >= 0 && worldWidth > 0 ? Math.floor((cell - tile.oreAnchor) / worldWidth) : -1;
  const policy = tile?.oreWidth === 3 && tile.oreHeight === 3 && code >= 2 && code <= 4 && row >= 0 && row < 3
    ? tallOrePolicies[row] : policies[code];
  return !!(policy & (saltAccess ? 1 : 3));
};

export function resourceFootprintBlocked(world: World, x: number, y: number, width = 1, height = width): boolean {
  return !!resourceFootprintError(world, x, y, width, height);
}

export function resourceFootprintError(world: World, x: number, y: number, width = 1, height = width): string | undefined {
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++)
    if (resourceBlocksGround(tileAt(world, x + dx, y + dy))) return resourceBlocksGround(tileAt(world, x + dx, y + dy), true)
      ? 'Stone and ore deposits block construction.' : 'Salt pans block construction.';
}
