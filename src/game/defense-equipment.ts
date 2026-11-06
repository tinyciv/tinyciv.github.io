import { equipmentMultiplier } from './equipment';
import { isWallKind, type Building, type Faction } from './types';
import { fortificationArmorMultiplier } from './wall-stats';

type EquipmentOwner = Pick<Faction, 'armorLevel' | 'weaponLevel'> | undefined;

export function isDefensiveBuilding(building: Pick<Building, 'kind' | 'palaceLevel'>): boolean {
  return isWallKind(building.kind) || building.kind === 'fort' || building.kind === 'tower' || building.kind === 'woodenTower'
    || building.kind === 'guardPost' || building.kind === 'ballista' || building.kind === 'palace' && building.palaceLevel === 2;
}

/** Derive equipment from the current owner. Authored armor and research health
 * stay untouched, so new/captured structures cannot inherit stacked bonuses. */
export function buildingArmor(building: Pick<Building, 'kind' | 'palaceLevel' | 'armor' | 'fortificationHealthMultiplier'>, owner: EquipmentOwner): number {
  return (building.armor ?? 2) * fortificationArmorMultiplier(building)
    * (isDefensiveBuilding(building) ? equipmentMultiplier(owner?.armorLevel) : 1);
}

export function buildingWeaponMultiplier(building: Pick<Building, 'kind' | 'palaceLevel'>, owner: EquipmentOwner): number {
  return isDefensiveBuilding(building) ? equipmentMultiplier(owner?.weaponLevel) : 1;
}
