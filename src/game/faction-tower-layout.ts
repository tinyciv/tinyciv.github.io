import { nativeCityTowers, nativeDefenseRejected, nativeDefenseSite } from './faction-defense-native';
import type { Building, GameState, Point } from './types';

export const FACTION_CITY_TOWERS = 4;
export interface FactionTowerSite { tower: Point }

export function factionCityTowers(state: GameState, palace: Building): Building[] {
  return nativeCityTowers(state, palace);
}

/** The native planner checks one real tower with an open walking ring. NPC
 * realms do not buy palisade enclosures, so no temporary walled world is needed.
 * Runtime calls perform at most two authoritative command validations; native
 * cursors retain the remaining cheap geometry work for a later due plan. */
export function nextFactionTowerEnclosure(state: GameState, palace: Building,
  allowed?: (point: Point) => boolean): FactionTowerSite | undefined {
  for (let attempt = 0; attempt < (allowed ? 2 : 1); attempt++) {
    const tower = nativeDefenseSite(state, palace, allowed ? 64 : 400);
    if (!tower) return;
    if (!allowed || allowed(tower)) return { tower };
    nativeDefenseRejected(state, palace);
  }
}
