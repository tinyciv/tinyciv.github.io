import { spendGold } from './gold-ledger';
import { playerFaction } from './player-context';
import { buildingActivityAvailable, BUILDING_ACTIVITY_RANGE } from './building-activity';
import { synchronizeFarms } from './farms';
import { governingPalace } from './governor';
import { buildingReady, type Building, type GameState } from './types';

export const IMMIGRANT_COST = 100;

export function immigrationStatus(state: GameState, palace: Building): { available: boolean; reason: string } {
  const faction = state.factions.find(candidate => candidate.id === palace.faction);
  let reason = '';
  if (state.gameOver || faction?.defeated) reason = 'Your realm can no longer import immigrants.';
  else if (palace.kind !== 'palace' || palace.faction !== playerFaction(state) || !faction || !state.buildings.includes(palace)) reason = 'Choose your own settlement.';
  else if (!buildingReady(palace)) reason = 'Complete the settlement first.';
  else if (!buildingActivityAvailable(state, palace)) reason = `Move your Leader within ${BUILDING_ACTIVITY_RANGE} tiles of the settlement.`;
  else if (faction.gold < IMMIGRANT_COST) reason = `Need ${IMMIGRANT_COST} gold.`;
  return { available: !reason, reason };
}

/** One paid resident joins the selected city immediately. A city without a
 * vacant bed keeps the resident locally until its housing catches up. */
export function importImmigrant(state: GameState, palace: Building): { ok: boolean; message: string } {
  const status = immigrationStatus(state, palace);
  if (!status.available) return { ok: false, message: status.reason };
  const faction = state.factions.find(candidate => candidate.id === palace.faction)!;
  synchronizeFarms(state);
  const home = state.buildings.find(building => building.kind === 'house' && building.faction === palace.faction
    && buildingReady(building) && (building.residents ?? 0) < building.capacity
    && governingPalace(state, { x: building.x + .5, y: building.y + .5 }, palace.faction)?.id === palace.id);
  spendGold(state, faction, IMMIGRANT_COST, 'immigration');
  faction.population++; delete palace.depopulated;
  if (home) home.residents = (home.residents ?? 0) + 1;
  else palace.unhousedResidents = (palace.unhousedResidents ?? 0) + 1;
  synchronizeFarms(state);
  return { ok: true, message: `${palace.cityName ?? 'Your city'} welcomed an immigrant: +1 population.` };
}
