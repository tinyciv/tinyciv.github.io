import { spendGold } from './gold-ledger';
import { playerFaction } from './player-context';
import { buildingActivityAvailable, BUILDING_ACTIVITY_RANGE } from './building-activity';
import { researchLevel } from './research';
import { buildingReady, type Building, type GameState } from './types';
import { markWorldChanged } from './world-revisions';

export const SETTLEMENT_MAX_HP = 650;
export const KEEP_MAX_HP = SETTLEMENT_MAX_HP * 10;
export const KEEP_HOUSING = 10;
export const KEEP_HOUSING_BONUS = 15;
export const KEEP_HOUSING_COST = 1000;

export const isKeep = (building: Pick<Building, 'kind' | 'palaceLevel'>): boolean =>
  building.kind === 'palace' && building.palaceLevel === 2;

export const settlementLabel = (building: Pick<Building, 'kind' | 'palaceLevel'>): 'Settlement' | 'Keep' =>
  isKeep(building) ? 'Keep' : 'Settlement';

export function settlementUpgradeStatus(state: GameState, building: Building): { available: boolean; reason: string } {
  const player = state.factions.find(faction => faction.id === playerFaction(state));
  let reason = '';
  if (state.gameOver || player?.defeated) reason = 'Your realm can no longer upgrade settlements.';
  else if (building.kind !== 'palace' || building.faction !== playerFaction(state) || !player || !state.buildings.includes(building))
    reason = 'Choose your own settlement.';
  else if (!Number.isFinite(building.hp) || !Number.isFinite(building.maxHp) || building.hp <= 0 || building.maxHp <= 0)
    reason = 'Only a surviving settlement can be upgraded.';
  else if (!buildingReady(building)) reason = 'Complete the settlement first.';
  else if (isKeep(building)) reason = 'Already a Keep.';
  else if (!researchLevel(player, 'woodenTower')) reason = 'Research Fortification first.';
  else if (!buildingActivityAvailable(state, building))
    reason = `Move your Leader within ${BUILDING_ACTIVITY_RANGE} tiles of the settlement.`;
  return { available: !reason, reason };
}

export const canUpgradeSettlement = (state: GameState, building: Building): boolean =>
  settlementUpgradeStatus(state, building).available;

/** Fortification unlocks one free conversion without repairing existing damage. */
export function upgradeSettlement(state: GameState, building: Building): { ok: boolean; message: string } {
  const status = settlementUpgradeStatus(state, building);
  if (!status.available) return { ok: false, message: status.reason };
  const healthFraction = Math.max(0, Math.min(1, building.hp / building.maxHp));
  building.palaceLevel = 2;
  building.maxHp = KEEP_MAX_HP;
  building.hp = KEEP_MAX_HP * healthFraction;
  building.capacity = KEEP_HOUSING;
  // Visible building memories also render while paused. Refresh them without
  // rebuilding terrain or changing sight/collision geometry.
  markWorldChanged(state.world);
  return { ok: true, message: `${building.cityName ?? 'Settlement'} upgraded to a Keep.` };
}

export function keepHousingUpgradeStatus(state: GameState, building: Building): { available: boolean; reason: string } {
  const player = state.factions.find(faction => faction.id === playerFaction(state));
  let reason = '';
  if (state.gameOver || player?.defeated) reason = 'Your realm can no longer expand Keeps.';
  else if (!isKeep(building) || building.faction !== playerFaction(state) || !player || !state.buildings.includes(building))
    reason = 'Choose your own Keep.';
  else if (!buildingReady(building)) reason = 'Complete the Keep first.';
  else if (building.keepHousingExpanded) reason = 'Keep housing is fully expanded.';
  else if (!buildingActivityAvailable(state, building))
    reason = `Move your Leader within ${BUILDING_ACTIVITY_RANGE} tiles of the Keep.`;
  else if (!Number.isFinite(player.gold) || player.gold < KEEP_HOUSING_COST) reason = `Need ${KEEP_HOUSING_COST} gold.`;
  return { available: !reason, reason };
}

/** Add beds without creating residents, repairing damage, or changing income. */
export function purchaseKeepHousing(state: GameState, building: Building): { ok: boolean; message: string } {
  const status = keepHousingUpgradeStatus(state, building);
  if (!status.available) return { ok: false, message: status.reason };
  spendGold(state, state.factions.find(faction => faction.id === building.faction)!, KEEP_HOUSING_COST, 'upgrades');
  building.keepHousingExpanded = true;
  building.capacity = KEEP_HOUSING + KEEP_HOUSING_BONUS;
  markWorldChanged(state.world);
  return { ok: true, message: `${building.cityName ?? 'Keep'} now provides ${building.capacity} housing.` };
}
