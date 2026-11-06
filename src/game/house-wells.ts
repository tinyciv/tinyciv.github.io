import type { Building } from './types';

type Site = Pick<Building, 'kind' | 'faction' | 'x' | 'y'>;

/** A house and its owner's well can share a logical tile. Each keeps its own
 * ID, construction, health and effects; artwork never changes occupancy. */
export function canShareHouseWellTile(a: Site, b: Site): boolean {
  return a.faction === b.faction && a.x === b.x && a.y === b.y
    && (a.kind === 'house' && b.kind === 'well' || a.kind === 'well' && b.kind === 'house');
}

export function sharedHouseForWell(well: Building, buildings: readonly Building[]): Building | undefined {
  if (well.kind !== 'well' || well.hp <= 0) return;
  return buildings.find(building => building.hp > 0 && canShareHouseWellTile(well, building));
}

export function sharedWellForHouse(house: Building, buildings: readonly Building[]): Building | undefined {
  if (house.kind !== 'house' || house.hp <= 0) return;
  return buildings.find(building => building.hp > 0 && canShareHouseWellTile(house, building));
}

/** Approved gallery option2A, in logical tiles (16 native pixels per tile). */
export const HOUSE_WELL_OFFSET = { x: -6 / 16, y: 3 / 16 } as const;
/** Opaque extent of source(80,480,16,16) after the front-left offset. */
export const HOUSE_WELL_BOUNDS = { left: -3 / 16, top: 6 / 16, right: 6 / 16, bottom: 18 / 16 } as const;
