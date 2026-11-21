import { rustEngine } from './rust-engine';
import { tileAt, WATER, type Terrain, type Tile, type World } from './types';

export const FRESHWATER_FERTILITY_BONUS = .25;
export const FERTILITY_DISTANCE_STEP = .05;
export const FERTILITY_BONUS_DISTANCE = 5;

export function baseSoilFertility(terrain: Terrain): number {
  return WATER.has(terrain) ? 0 : terrain === 'tundra' ? .25 : terrain === 'desert' ? .5 : terrain === 'plains' ? .75 : 1;
}

/** Adjacent freshwater adds 25 percentage points, tapering to zero at six tiles. */
export function freshwaterFertilityBonus(distance: number): number {
  return Math.max(0, FRESHWATER_FERTILITY_BONUS - Math.max(0, distance - 1) * FERTILITY_DISTANCE_STEP);
}

export function fertilityGrassTerrain(tile: Tile): boolean {
  return tile.terrain === 'grassland' || tile.terrain === 'plains';
}

export function fertilityGrassFooting(tile: Tile): boolean {
  return fertilityGrassTerrain(tile) && (tile.overlay === 'none' || tile.overlay === 'forest' || tile.overlay === 'jungle')
    && !tile.beach && !tile.marsh
    && !tile.snow && !tile.creek && !tile.relief && !tile.waterfall && !tile.geothermal
    && tile.resource !== 'salt' && !tile.villageTrail;
}

function soilBeforeGrass(world: World, tx: number, ty: number, tile: Tile): number {
  if (tile.fertility !== undefined && Number.isFinite(tile.fertility)) return Math.max(0, Math.min(1.25, tile.fertility));
  for (let distance = 1; distance <= FERTILITY_BONUS_DISTANCE; distance++) {
    for (let dx = -distance; dx <= distance; dx++) {
      const dy = distance - Math.abs(dx);
      for (const offsetY of dy ? [-dy, dy] : [0]) {
        const source = tileAt(world, tx + dx, ty + offsetY)?.terrain;
        if (source === 'river' || source === 'lake') return baseSoilFertility(tile.terrain) + freshwaterFertilityBonus(distance);
      }
    }
  }
  return baseSoilFertility(tile.terrain);
}

/** Generated soil and patch density are both indexed directly by tile. */
export function soilFertility(world: World, x: number, y: number): number {
  const tx = Math.floor(x), ty = Math.floor(y), tile = tileAt(world, tx, ty);
  if (!tile || WATER.has(tile.terrain)) return 0;
  const base = soilBeforeGrass(world, tx, ty, tile);
  return tile.fertilityGrass && fertilityGrassTerrain(tile)
    ? rustEngine.fertility_grass_soil(base, tile.fertilityGrass) : base;
}
