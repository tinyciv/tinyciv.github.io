import { tileAt, WATER, type Terrain, type World } from './types';

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

/** Generation stores the exact multiplier, making normal harvest/UI reads O(1).
 * Small hand-built worlds can derive it locally without a full-map cache scan. */
export function soilFertility(world: World, x: number, y: number): number {
  const tx = Math.floor(x), ty = Math.floor(y), tile = tileAt(world, tx, ty);
  if (!tile || WATER.has(tile.terrain)) return 0;
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
