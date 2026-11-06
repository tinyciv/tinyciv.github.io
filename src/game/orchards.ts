import { spendGold } from './gold-ledger';
import { playerFaction } from './player-context';
import { buildingActivityAvailable, BUILDING_ACTIVITY_RANGE } from './building-activity';
import { buildingReady, distance, isFarmKind, type Building, type GameState } from './types';
import { invalidateScheduledHarvests } from './farms';

export const ORCHARD_UPGRADE_COST = 5;
export const ORCHARD_ESTABLISH_SECONDS = 120;
export const ORCHARD_YIELD_MULTIPLIER = 1.5;
export type OrchardUpgradeCount = 1 | 10;

export const orchardReady = (farm: Building, time: number): boolean => !!farm.orchard && time + 1e-7 >= farm.orchard.readyAt;
export const farmHarvestMultiplier = (farm: Building, time: number): number => !farm.orchard ? 1
  : orchardReady(farm, time) ? ORCHARD_YIELD_MULTIPLIER : 0;

export interface OrchardUpgradeStatus {
  available: boolean;
  reason: string;
  cost: number;
  count: OrchardUpgradeCount;
  farmIds: number[];
}

/** A bulk upgrade is one atomic purchase of exactly ten ready, ordinary farms.
 * The chosen farm anchors distance; already upgraded plots are skipped. */
export function orchardUpgradeStatus(state: GameState, farm: Building, count: OrchardUpgradeCount = 1): OrchardUpgradeStatus {
  const faction = state.factions.find(candidate => candidate.id === farm.faction);
  const candidates = state.buildings.filter(candidate => candidate.faction === farm.faction && isFarmKind(candidate.kind)
    && buildingReady(candidate) && !candidate.orchard && !candidate.farmSuppressed)
    .sort((a, b) => distance(a, farm) - distance(b, farm) || a.id - b.id);
  const selected = count === 1 ? candidates.filter(candidate => candidate.id === farm.id) : candidates.slice(0, count);
  const cost = count * ORCHARD_UPGRADE_COST;
  let reason = '';
  if (state.gameOver || faction?.defeated) reason = 'Your realm can no longer upgrade farms.';
  else if (!isFarmKind(farm.kind) || farm.faction !== playerFaction(state) || !faction || !state.buildings.includes(farm)) reason = 'Choose your own farm.';
  else if (!buildingReady(farm)) reason = 'Complete the farm first.';
  else if (!buildingActivityAvailable(state, farm)) reason = `Move your Leader within ${BUILDING_ACTIVITY_RANGE} tiles of the farm.`;
  else if (selected.length < count) reason = count === 1 && farm.orchard ? 'This farm is already an orchard.'
    : `Need ${count} ordinary completed farm${count === 1 ? '' : 's'}.`;
  else if (faction.gold < cost) reason = `Need ${cost} gold.`;
  return { available: !reason, reason, cost, count, farmIds: selected.map(candidate => candidate.id) };
}

export function purchaseOrchardUpgrade(state: GameState, farm: Building, count: OrchardUpgradeCount = 1): { ok: boolean; message: string } {
  const status = orchardUpgradeStatus(state, farm, count);
  if (!status.available) return { ok: false, message: status.reason };
  const selected = new Set(status.farmIds), readyAt = state.time + ORCHARD_ESTABLISH_SECONDS;
  spendGold(state, state.factions.find(faction => faction.id === farm.faction)!, status.cost, 'upgrades');
  for (const candidate of state.buildings) if (selected.has(candidate.id)) {
    candidate.orchard = { startedAt: state.time, readyAt };
    candidate.farmLastVisitedAt = state.time;
    candidate.farmFallow = false;
    delete candidate.farmAbandonedAt;
  }
  for (const field of state.fields ?? []) if (selected.has(field.camp)) {
    field.orchard = { startedAt: state.time, readyAt };
    field.planted = false;
    field.nextHarvest = readyAt;
    delete field.harvestedAt;
  }
  state.farmVersion = (state.farmVersion ?? 0) + 1;
  invalidateScheduledHarvests(state);
  return { ok: true, message: `${count === 1 ? 'Orchard' : `${count} orchards`} planted: ready in ${ORCHARD_ESTABLISH_SECONDS} seconds, with 50% more food.` };
}
