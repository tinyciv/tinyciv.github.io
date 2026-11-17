import { cityOwnership } from './city-ownership';
import { citySummariesForFaction } from './cities';
import { buildingReady, buildingHeight, buildingWidth, type Building, type GameState, type Point } from './types';

/** Public games: a realm with any completed Colosseum grows twice as fast. */
export const COLOSSEUM_GROWTH_MULTIPLIER = 2;
/** +200% culture within 5 tiles, falling 10 points per tile to nothing at 25. */
export const COLOSSEUM_CULTURE_BONUS = 2;
export const COLOSSEUM_CULTURE_FULL_RADIUS = 5;
export const COLOSSEUM_CULTURE_FALLOFF_PER_TILE = .1;
/** A Colosseum must be built for a town of at least this many people. */
export const COLOSSEUM_MIN_CITY_POPULATION = 200;

const centerOf = (building: Building): Point => ({ x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 });
export const completedColosseums = (state: GameState, faction: number): Building[] =>
  state.buildings.filter(building => building.kind === 'colosseum' && building.faction === faction && buildingReady(building));

/** Realm-wide; extra Colosseums do not stack. */
export function colosseumGrowthMultiplier(state: GameState, faction: number): number {
  return completedColosseums(state, faction).length ? COLOSSEUM_GROWTH_MULTIPLIER : 1;
}

/** The culture bonus at a distance from a Colosseum's center, in tiles. */
export function colosseumCultureBonus(distance: number): number {
  if (!(distance >= 0)) return 0;
  if (distance <= COLOSSEUM_CULTURE_FULL_RADIUS) return COLOSSEUM_CULTURE_BONUS;
  return Math.max(0, COLOSSEUM_CULTURE_BONUS - COLOSSEUM_CULTURE_FALLOFF_PER_TILE * (distance - COLOSSEUM_CULTURE_FULL_RADIUS));
}

/** Culture multiplier for a source at `point`: only the strongest Colosseum counts. */
export function colosseumCultureMultiplier(colosseums: readonly Building[], point: Point): number {
  let best = 0;
  for (const colosseum of colosseums) {
    const center = centerOf(colosseum);
    best = Math.max(best, colosseumCultureBonus(Math.hypot(center.x - point.x, center.y - point.y)));
  }
  return 1 + best;
}

/** The town that would own a Colosseum at `point`, when it has 200 people. */
export function colosseumSiteError(state: GameState, faction: number, point: Point): string {
  const city = cityOwnership(state).nearest({ x: point.x + 1, y: point.y + 1 }, faction);
  const population = city ? citySummariesForFaction(state, faction).find(summary => summary.palace.id === city.id)?.population ?? 0 : 0;
  return population >= COLOSSEUM_MIN_CITY_POPULATION ? ''
    : `A Colosseum needs a town of ${COLOSSEUM_MIN_CITY_POPULATION} people${city ? ` (${city.cityName ?? 'this town'} has ${Math.floor(population)})` : ''}.`;
}
