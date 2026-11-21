import { spendGold } from './gold-ledger';
import { playerFaction } from './player-context';
import { buildingActivityAvailable, BUILDING_ACTIVITY_RANGE } from './building-activity';
import { researchLevel } from './research';
import { buildingReady, type Building, type GameState } from './types';
import { markWorldChanged } from './world-revisions';
import { rustEngine } from './rust-engine';
import { cityResidents } from './cities';
import { entityStore } from './entity-store';
import { structureIndex } from './structure-index';
import { invalidateDecisions } from './decision-schedule';
import { invalidateFogBuildingMemories } from './fog';

export const SETTLEMENT_MAX_HP = 650;
export const KEEP_MAX_HP = SETTLEMENT_MAX_HP * 10;
export const KEEP_HOUSING = 10;
export const KEEP_HOUSING_BONUS = 15;
export const KEEP_UPGRADE_COST = rustEngine.progression_constant(9);
export const KEEP_HOUSING_COST = rustEngine.progression_constant(10);

export const isKeep = (building: Pick<Building, 'kind' | 'palaceLevel'>): boolean =>
  building.kind === 'palace' && building.palaceLevel === 2;

const LABELS = ['Settlement', 'Town', 'City', 'Metropolis'] as const;
const tiers = LABELS.map((label, index) => ({
  label,
  capacity: rustEngine.settlement_tier_term(index, 0),
  cost: rustEngine.settlement_tier_term(index, 1),
  buildings: rustEngine.settlement_tier_term(index, 2),
}));
type Tier = NonNullable<Building['settlementTier']>;
type TierTerms = (typeof tiers)[number];
export const settlementTierForPopulation = (population: number): Tier => rustEngine.settlement_tier_for_population(population) as Tier;
export const settlementLabel = (building: Pick<Building, 'settlementTier'>): TierTerms['label'] => tiers[building.settlementTier ?? 0].label;
export const settlementPopulationLimit = (building: Pick<Building, 'settlementTier'>): number => tiers[building.settlementTier ?? 0].capacity;

export function settlementTierStatus(state: GameState, building: Building, factionId = playerFaction(state)): {
  available: boolean; reason: string; tier: TierTerms['label']; population: number; limit: number; buildings: number; next?: TierTerms;
} {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  const tier = building.settlementTier ?? 0;
  const next: TierTerms | undefined = tiers[tier + 1];
  const valid = building.kind === 'palace' && building.villageId === undefined && building.faction === factionId
    && !!faction && entityStore(state).buildings.get(building.id) === building;
  const ready = valid && buildingReady(building);
  const buildings = ready && next ? structureIndex(state).civicCount(building) : 0;
  const population = ready ? cityResidents(state).find(city => city.palace.id === building.id)?.population ?? 0 : 0;
  let reason = '';
  if (state.gameOver || faction?.defeated) reason = 'Your realm can no longer upgrade settlements.';
  else if (!valid) reason = 'Choose your own settlement.';
  else if (!ready) reason = 'Complete the settlement first.';
  else {
    const result = rustEngine.settlement_tier_upgrade(tier, buildings, faction!.gold);
    if (result === 1) reason = 'Highest tier reached.';
    if (result === 2) reason = `Requires ${next!.buildings} completed civic buildings.`;
    if (result === 3) reason = `Needs ${next!.cost.toLocaleString('en-US')} gold.`;
  }
  return { available: !reason, reason, tier: tiers[tier].label, population, limit: tiers[tier].capacity, buildings, next };
}

export function upgradeSettlementTier(state: GameState, building: Building, factionId = playerFaction(state)): { ok: boolean; message: string } {
  const status = settlementTierStatus(state, building, factionId);
  if (!status.available || !status.next) return { ok: false, message: status.reason };
  spendGold(state, state.factions.find(faction => faction.id === factionId)!, status.next.cost, 'upgrades');
  building.settlementTier = ((building.settlementTier ?? 0) + 1) as Tier;
  invalidateFogBuildingMemories(state);
  invalidateDecisions(state);
  return { ok: true, message: `${building.cityName ?? 'Settlement'} promoted to ${status.next.label}.` };
}

export function settlementUpgradeStatus(state: GameState, building: Building): { available: boolean; reason: string } {
  const player = state.factions.find(faction => faction.id === playerFaction(state));
  let reason = '';
  if (state.gameOver || player?.defeated) reason = 'Your realm can no longer upgrade settlement defenses.';
  else if (building.kind !== 'palace' || building.faction !== playerFaction(state) || !player || !state.buildings.includes(building))
    reason = 'Choose your own settlement.';
  else if (!Number.isFinite(building.hp) || !Number.isFinite(building.maxHp) || building.hp <= 0 || building.maxHp <= 0)
    reason = 'Only a surviving settlement can be upgraded.';
  else if (!buildingReady(building)) reason = 'Complete the settlement first.';
  else if (isKeep(building)) reason = 'Defenses already upgraded.';
  else if (!researchLevel(player, 'woodenTower')) reason = 'Research Fortification first.';
  else if (!buildingActivityAvailable(state, building))
    reason = `Move your Leader within ${BUILDING_ACTIVITY_RANGE} tiles of the settlement.`;
  else if (rustEngine.progression_purchase(player.gold, KEEP_UPGRADE_COST) < 0) reason = `Need ${KEEP_UPGRADE_COST} gold.`;
  return { available: !reason, reason };
}

export const canUpgradeSettlement = (state: GameState, building: Building): boolean =>
  settlementUpgradeStatus(state, building).available;

/** Fortification unlocks a paid conversion without repairing existing damage. */
export function upgradeSettlement(state: GameState, building: Building): { ok: boolean; message: string } {
  const status = settlementUpgradeStatus(state, building);
  if (!status.available) return { ok: false, message: status.reason };
  const healthFraction = Math.max(0, Math.min(1, building.hp / building.maxHp));
  spendGold(state, state.factions.find(faction => faction.id === building.faction)!, KEEP_UPGRADE_COST, 'upgrades');
  building.palaceLevel = 2;
  building.maxHp = KEEP_MAX_HP * (building.enemyStrengthMultiplier ?? 1);
  building.hp = building.maxHp * healthFraction;
  building.capacity = KEEP_HOUSING;
  invalidateFogBuildingMemories(state);
  markWorldChanged(state.world);
  return { ok: true, message: `Defenses upgraded in ${building.cityName ?? 'your settlement'}.` };
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
  else if (rustEngine.progression_purchase(player.gold, KEEP_HOUSING_COST) < 0) reason = `Need ${KEEP_HOUSING_COST} gold.`;
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
