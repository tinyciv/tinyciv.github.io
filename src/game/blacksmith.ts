import { spendGold } from './gold-ledger';
import { playerFaction } from './player-context';
import { isRetinueMember } from './types';
import { buildingActivityAvailable, BUILDING_ACTIVITY_RANGE } from './building-activity';
import { equipmentMultiplier, MAX_EQUIPMENT_LEVEL } from './equipment';
import { buildingReady, type Building, type EquipmentLevel, type Faction, type GameState, type Unit } from './types';

export type BlacksmithUpgradeTrack = 'armor' | 'weapon';
export const BLACKSMITH_UPGRADE_COSTS = [200, 400, 600, 800, 1000, 1200] as const;

export interface BlacksmithUpgradeStatus {
  level: EquipmentLevel;
  nextLevel: EquipmentLevel | null;
  currentMultiplier: number;
  /** The multiplier purchased by the next tier, or the current one at max tier. */
  multiplier: number;
  cost: number | null;
  available: boolean;
  reason: string;
}

/** Units store their issued tiers; defensive structures derive the current
 * owner's tiers when calculating combat stats. Workers remain unequipped. */
export function equipUnitFromFaction(unit: Unit, faction: Pick<Faction, 'armorLevel' | 'weaponLevel'> | undefined): void {
  if (unit.kind !== 'leader' && unit.kind !== 'levyInfantry' && unit.kind !== 'skirmisher' && !isRetinueMember(unit)) return;
  unit.armorLevel = faction?.armorLevel ?? 0;
  unit.weaponLevel = faction?.weaponLevel ?? 0;
}

export function applyFactionEquipment(state: GameState, factionId: number): void {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  for (const unit of state.units) if (unit.faction === factionId) equipUnitFromFaction(unit, faction);
}

/** Read-only preview and purchase share these checks, including live Leader reach. */
export function blacksmithUpgradeStatus(state: GameState, building: Building, track: BlacksmithUpgradeTrack): BlacksmithUpgradeStatus {
  const faction = state.factions.find(candidate => candidate.id === building.faction);
  const level = faction?.[track === 'armor' ? 'armorLevel' : 'weaponLevel'] ?? 0;
  const nextLevel = level < MAX_EQUIPMENT_LEVEL ? (level + 1) as EquipmentLevel : null;
  const cost = level === MAX_EQUIPMENT_LEVEL ? null : BLACKSMITH_UPGRADE_COSTS[level];
  let reason = '';
  if (state.gameOver || faction?.defeated) reason = 'Your realm can no longer upgrade equipment.';
  else if (building.kind !== 'blacksmith' || building.faction !== playerFaction(state) || !faction || !state.buildings.includes(building))
    reason = 'Choose your own blacksmith.';
  else if (!buildingReady(building)) reason = 'Complete the blacksmith first.';
  else if (!buildingActivityAvailable(state, building)) reason = `Move your Leader within ${BUILDING_ACTIVITY_RANGE} tiles of the blacksmith.`;
  else if (nextLevel === null) reason = 'Fully upgraded.';
  else if (faction.gold < cost!) reason = `Need ${cost} gold.`;
  return { level, nextLevel, currentMultiplier: equipmentMultiplier(level), multiplier: equipmentMultiplier(nextLevel ?? level),
    cost, available: !reason, reason };
}

export function purchaseBlacksmithUpgrade(state: GameState, building: Building, track: BlacksmithUpgradeTrack): { ok: boolean; message: string } {
  const status = blacksmithUpgradeStatus(state, building, track);
  if (!status.available) return { ok: false, message: status.reason };
  const faction = state.factions.find(candidate => candidate.id === building.faction)!;
  spendGold(state, faction, status.cost!, 'upgrades');
  faction[track === 'armor' ? 'armorLevel' : 'weaponLevel'] = status.nextLevel!;
  applyFactionEquipment(state, faction.id);
  return { ok: true, message: `${track === 'armor' ? 'Armor' : 'Weapon'} upgraded: ${status.multiplier}× ${track === 'armor' ? 'defense' : 'attack'} for your Leader, retinue and ${track === 'armor' ? 'defensive buildings' : 'tower attacks'}.` };
}
