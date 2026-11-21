import type { Biome, RegionalResource, Tile } from './types';
import { rustEngine } from './rust-engine';

export const BIOME_NAMES: Record<Biome, string> = {
  temperate: 'Temperate country', taiga: 'Taiga', tundra: 'Tundra', rainforest: 'Rainforest',
  savanna: 'Savanna', steppe: 'Steppe', desert: 'Desert', wetland: 'Wetland', alpine: 'Alpine country', forest: 'Forest',
  fjords: 'Fjords',
};
export function forestBlocksConstruction(tile: Pick<Tile, 'biome' | 'overlay'> | undefined): boolean {
  return tile?.biome === 'forest' && tile.overlay === 'forest';
}

export const RESOURCE_NAMES: Record<RegionalResource, string> = {
  clay: 'Clay', copper: 'Copper', iron: 'Iron', gold: 'Gold ore', stone: 'Stone', salt: 'Salt', olives: 'Olives', fish: 'Fish', marble: 'Marble quarry',
  peat: 'Peat', grapes: 'Wild grapes', coal: 'Coal',
};
export function resourceName(tile: Tile | undefined): string | undefined {
  return tile?.resource && RESOURCE_NAMES[tile.resource];
}
export const RESOURCE_COLORS: Record<RegionalResource, string> = {
  clay: '#d99875', copper: '#cb7841', iron: '#a4bacd', gold: '#e6bd45', stone: '#ded5bd', salt: '#faf6ea', olives: '#70854a', fish: '#9be7f0', marble: '#e8e1d6',
  peat: '#835b45', grapes: '#a378b8', coal: '#444a58',
};

/** Shared by route costs, physical movement, and the terrain inspector. Roads
 * and bridges override these ground costs in the navigation layer. */
export const VILLAGE_TRAIL_SPEED_MULTIPLIER = 1.05;
const SNOW_SPEED = rustEngine.snow_speed_multiplier();
export function applySnowSpeed(tile: Tile, speed: number): number {
  return tile.snow ? speed * SNOW_SPEED : speed;
}

export function groundMovementMultiplier(tile: Tile): number {
  const trail = tile.villageTrail ? VILLAGE_TRAIL_SPEED_MULTIPLIER : 1;
  if (tile.terrain === 'river' && tile.overlay === 'ford') return applySnowSpeed(tile, .45 * trail);
  const cover = tile.overlay === 'forest' || tile.overlay === 'jungle' ? .5 : tile.overlay === 'swamp' ? .7 : 1;
  const tundra = tile.biome === 'tundra' || tile.biome === 'fjords' && tile.terrain === 'tundra';
  const biome = tile.biome === 'wetland' ? .7 : tile.biome === 'alpine' ? .8 : tundra ? .9 : 1;
  return applySnowSpeed(tile, Math.min(cover, biome, tile.reliefSpeed ?? 1) * trail);
}
