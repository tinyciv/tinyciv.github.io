import type { Faction, Unit } from './types';
import { equipmentMultiplier } from './equipment';
import { archerDamageMultiplier } from './research-bonuses';
import { drawRankMarker } from './veterancy-art';
import { RAIDER_ATTACK_MULTIPLIER } from './raider-pressure';

export type Veterancy = 0 | 1 | 2 | 3 | 4;
export const VETERANCY_KILLS = [10, 100, 250, 500] as const;
export const VETERANCY_NAMES = ['Untrained', 'Regular', 'Veteran', 'Hardened', 'Elite'] as const;
export function veterancy(unit: Pick<Unit, 'kills'>): Veterancy {
  const kills = unit.kills ?? 0;
  return kills >= 500 ? 4 : kills >= 250 ? 3 : kills >= 100 ? 2 : kills >= 10 ? 1 : 0;
}
export const DAMAGE_MULTIPLIER = .7;
export const ELITE_DAMAGE_MULTIPLIER = 2.3;
export const ELITE_DAMAGE_TAKEN_MULTIPLIER = .15;
export const unitDamageDealtMultiplier = (unit: Pick<Unit, 'kills'>): number => veterancy(unit) === 4 ? ELITE_DAMAGE_MULTIPLIER : 1;
export const unitDamageTakenMultiplier = (unit: Pick<Unit, 'kills'>): number => veterancy(unit) === 4 ? ELITE_DAMAGE_TAKEN_MULTIPLIER : 1;
/** Elite's percentage reductions apply to actual damage after ordinary armor. */
export const incomingUnitDamage = (unit: Pick<Unit, 'kills'>, damage: number): number => Math.max(0, damage) * unitDamageTakenMultiplier(unit);
// Elite replaces additive rank bonuses with exact multipliers relative to the
// same untrained unit, preserving its equipment and role. Do not stack both.
const ATTACK_BONUSES = [0, 3, 7, 12, 0] as const;
const DEFENSE_BONUSES = [0, 2, 5, 8, 0] as const;
const rawUnitAttack = (unit: Pick<Unit, 'attack' | 'kills' | 'weaponLevel'> & Partial<Pick<Unit, 'kind' | 'raiderEquipmentMultiplier'>>): number =>
  unit.kind === 'scout' ? 0 : (unit.attack + ATTACK_BONUSES[veterancy(unit)]) * equipmentMultiplier(unit.weaponLevel) * (unit.raiderEquipmentMultiplier ?? 1);
/** Apply the reduction after armor, including the minimum hit, so every hit
 * does exactly 30% less damage rather than making armor disproportionately strong. */
export const attackDamage = (attack: number, defense: number): number => Math.max(4, attack - defense) * DAMAGE_MULTIPLIER;
export const unitAttack = (unit: Pick<Unit, 'attack' | 'kills' | 'weaponLevel'> & Partial<Pick<Unit, 'kind' | 'faction' | 'raiderEquipmentMultiplier' | 'enemyStrengthMultiplier'>>, faction?: Pick<Faction, 'research'>): number =>
  rawUnitAttack(unit) * DAMAGE_MULTIPLIER * unitDamageDealtMultiplier(unit) * ((unit.kind === 'archer' || unit.kind === 'horseArcher') ? archerDamageMultiplier(faction) : 1)
    * (unit.faction === -2 ? RAIDER_ATTACK_MULTIPLIER : 1) * (unit.enemyStrengthMultiplier ?? 1);
export const unitDamage = (unit: Pick<Unit, 'attack' | 'kills' | 'weaponLevel'> & Partial<Pick<Unit, 'kind' | 'faction' | 'raiderEquipmentMultiplier' | 'enemyStrengthMultiplier'>>, defense: number, faction?: Pick<Faction, 'research'>): number =>
  unit.kind === 'scout' ? 0 : attackDamage(rawUnitAttack(unit), defense) * unitDamageDealtMultiplier(unit) * ((unit.kind === 'archer' || unit.kind === 'horseArcher') ? archerDamageMultiplier(faction) : 1)
    * (unit.faction === -2 ? RAIDER_ATTACK_MULTIPLIER : 1) * (unit.enemyStrengthMultiplier ?? 1);
export const unitDefense = (unit: Pick<Unit, 'defense' | 'kills' | 'armorLevel'> & Partial<Pick<Unit, 'kind' | 'raiderEquipmentMultiplier' | 'brace'>>): number =>
  (unit.defense + DEFENSE_BONUSES[veterancy(unit)]) * equipmentMultiplier(unit.armorLevel) * (unit.raiderEquipmentMultiplier ?? 1) + (unit.brace?.defense ?? 0);
export function recordKill(unit: Unit): void { unit.kills = Math.max(0, unit.kills ?? 0) + 1; }

/** Compact rank emblems sit beside the helmet, clear of the face and health bar. */
export function drawVeterancy(c: CanvasRenderingContext2D, unit: Unit, x: number, y: number, size: number): void {
  drawRankMarker(c, veterancy(unit), x, y, size);
}
