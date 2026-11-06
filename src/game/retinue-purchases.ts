import { spendGold } from './gold-ledger';
import { playerFaction } from './player-context';
import { buildingActivityAvailable, BUILDING_ACTIVITY_RANGE } from './building-activity';
import { ECONOMY_INTERVAL } from './economy-constants';
import { buildingReady, type Building, type Faction, type GameState } from './types';

export const RETINUE_SLOT_COST = 1000;
export const RETINUE_SLOT_UPKEEP = 5;
export const RETINUE_SLOT_UPKEEP_INTERVAL = ECONOMY_INTERVAL;

/** Capacity belongs to the faction, regardless of which settlement sold it or
 * whether a soldier currently occupies it. Recruitment still uses its normal clock. */
export function purchasedRetinueSlots(faction: Faction): number {
  return Number.isFinite(faction.purchasedRetinueSlots) ? Math.max(0, Math.floor(faction.purchasedRetinueSlots!)) : 0;
}

export function retinueSlotUpkeep(faction: Faction): number {
  return purchasedRetinueSlots(faction) * RETINUE_SLOT_UPKEEP;
}

export function retinueSlotPurchaseStatus(state: GameState, settlement: Building): {
  available: boolean; reason: string; slots: number; upkeep: number;
} {
  const faction = state.factions.find(candidate => candidate.id === settlement.faction);
  let reason = '';
  if (state.gameOver || faction?.defeated) reason = 'Your realm can no longer expand its retinue.';
  else if (settlement.kind !== 'palace' || settlement.faction !== playerFaction(state) || !faction || !state.buildings.includes(settlement)) reason = 'Choose your own settlement.';
  else if (!buildingReady(settlement)) reason = 'Complete the settlement first.';
  else if (!buildingActivityAvailable(state, settlement)) reason = `Move your Leader within ${BUILDING_ACTIVITY_RANGE} tiles of the settlement.`;
  else if (faction.gold < RETINUE_SLOT_COST) reason = `Need ${RETINUE_SLOT_COST} gold.`;
  return { available: !reason, reason, slots: faction ? purchasedRetinueSlots(faction) : 0,
    upkeep: faction ? retinueSlotUpkeep(faction) : 0 };
}

export function purchaseRetinueSlot(state: GameState, settlement: Building): { ok: boolean; message: string } {
  const status = retinueSlotPurchaseStatus(state, settlement);
  if (!status.available) return { ok: false, message: status.reason };
  const faction = state.factions.find(candidate => candidate.id === settlement.faction)!;
  spendGold(state, faction, RETINUE_SLOT_COST, 'army');
  faction.purchasedRetinueSlots = status.slots + 1;
  faction.yields.gold -= RETINUE_SLOT_UPKEEP;
  return { ok: true, message: `Retinue capacity increased by 1. Upkeep: ${RETINUE_SLOT_UPKEEP} gold every ${RETINUE_SLOT_UPKEEP_INTERVAL} seconds.` };
}
