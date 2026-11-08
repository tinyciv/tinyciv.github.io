import { type Biome, type HillBiome, type RegionalResource, type Tile } from './types';

export const HILL_BIOME_NAMES: Record<HillBiome, string> = {
  'desert-hills': 'Desert hills', 'forest-hills': 'Forest hills',
};

export const BIOME_NAMES: Record<Biome, string> = {
  temperate: 'Temperate country', taiga: 'Taiga', tundra: 'Tundra', rainforest: 'Rainforest',
  savanna: 'Savanna', steppe: 'Steppe', desert: 'Desert', wetland: 'Wetland', alpine: 'Alpine country',
};
export const RESOURCE_NAMES: Record<RegionalResource, string> = {
  clay: 'Clay', copper: 'Copper', iron: 'Iron', stone: 'Stone', salt: 'Salt', olives: 'Olives', fish: 'Fish',
};
export const RESOURCE_COLORS: Record<RegionalResource, string> = {
  clay: '#d99875', copper: '#cb7841', iron: '#c0cbd4', stone: '#ded5bd', salt: '#faf6ea', olives: '#70854a', fish: '#9be7f0',
};

/** Shared by route costs, physical movement, and the terrain inspector. Roads
 * and bridges override these ground costs in the navigation layer. */
export const VILLAGE_TRAIL_SPEED_MULTIPLIER = 1.05;
export function groundMovementMultiplier(tile: Tile): number {
  const trail = tile.villageTrail ? VILLAGE_TRAIL_SPEED_MULTIPLIER : 1;
  if (tile.terrain === 'river' && tile.overlay === 'ford') return .45 * trail;
  const cover = tile.overlay === 'forest' || tile.overlay === 'jungle' ? .5 : tile.overlay === 'swamp' ? .7 : 1;
  const biome = tile.biome === 'wetland' ? .7 : tile.biome === 'alpine' ? .8 : tile.biome === 'tundra' ? .9 : 1;
  return Math.min(cover, biome) * trail;
}
