import { isRetinueMember, type Faction, type Unit } from './types';
import { archerDamageMultiplier } from './research-bonuses';
import { drawRankMarker } from './veterancy-art';
import { rustEngine } from './rust-engine';
import { UNIT_KIND_CODES } from './entity-store';

export type Veterancy = 0 | 1 | 2 | 3 | 4;
export const VETERANCY_KILLS = [rustEngine.combat_constant(3), rustEngine.combat_constant(4),
  rustEngine.combat_constant(5), rustEngine.combat_constant(6)] as const;
export const VETERANCY_NAMES = ['Untrained', 'Regular', 'Veteran', 'Hardened', 'Elite'] as const;
export function veterancy(unit: Pick<Unit, 'kills'>): Veterancy {
  return rustEngine.combat_veterancy(unit.kills ?? 0) as Veterancy;
}
export const DAMAGE_MULTIPLIER = rustEngine.combat_constant(0);
export const ELITE_DAMAGE_MULTIPLIER = rustEngine.combat_constant(1);
export const ELITE_DAMAGE_TAKEN_MULTIPLIER = rustEngine.combat_constant(2);
export const ARCHER_HIT_MULTIPLIER = rustEngine.combat_constant(17);
export const unitDamageDealtMultiplier = (unit: Pick<Unit, 'kills'>): number => rustEngine.combat_dealt_multiplier(unit.kills ?? 0);
export const unitDamageTakenMultiplier = (unit: Pick<Unit, 'kills'>): number => rustEngine.combat_taken_multiplier(unit.kills ?? 0);
/** Elite's percentage reductions apply to actual damage after ordinary armor. */
export const incomingUnitDamage = (unit: Pick<Unit, 'kills'>, damage: number): number => rustEngine.combat_incoming_damage(unit.kills ?? 0, damage);
/** Apply the reduction after armor, including the minimum hit, so every hit
 * does exactly 30% less damage rather than making armor disproportionately strong. */
export const attackDamage = (attack: number, defense: number): number => rustEngine.combat_attack_damage(attack, defense);
type CulturalUnit = Partial<Pick<Unit, 'kind' | 'garrison' | 'guardPost' | 'fort'>>;
type UpkeepUnit = Partial<Pick<Unit, 'kind' | 'fieldCannon' | 'ranger'>>;
export const hasUnpaidUpkeep = (unit: UpkeepUnit, faction?: Pick<Faction, 'retinueFunded'>): boolean => {
  const { kind } = unit;
  if (kind === 'fieldCannon') return unit.fieldCannon?.funded === false;
  return faction?.retinueFunded === false && kind !== undefined && kind !== 'warrior' && !unit.ranger && isRetinueMember({ kind });
};
type CombatFaction = Pick<Faction, 'research' | 'questBenefits' | 'achievements' | 'retinueFunded'>;
/** Identity flags only; native combat owns cultural eligibility and arithmetic. */
const cultureContext = (unit: CulturalUnit, home: boolean): number => Number(home)
  | (unit.kind === 'leader' || unit.kind !== undefined && isRetinueMember({ kind: unit.kind }) ? 2 : 0)
  | (unit.kind === 'militia' ? 4 : 0) | (unit.garrison || unit.guardPost !== undefined || unit.fort !== undefined ? 8 : 0);
export const unitAttack = (unit: Pick<Unit, 'attack' | 'kills' | 'weaponLevel'> & CulturalUnit & UpkeepUnit & Partial<Pick<Unit, 'faction' | 'raiderEquipmentMultiplier' | 'enemyStrengthMultiplier' | 'technologyBonus' | 'raiderBonus'>>, faction?: CombatFaction, home = false): number =>
  rustEngine.combat_unit_attack(unit.kind === undefined ? -1 : UNIT_KIND_CODES[unit.kind], unit.attack, unit.kills ?? 0, unit.weaponLevel ?? 0,
    unit.raiderEquipmentMultiplier ?? 1, (unit.kind === 'archer' || unit.kind === 'horseArcher') ? archerDamageMultiplier(faction) : 1,
    Number(unit.faction === -2), unit.enemyStrengthMultiplier ?? 1, unit.technologyBonus?.attack ?? 0, unit.raiderBonus?.attack ?? 0,
    faction?.achievements ?? 0, cultureContext(unit, home), faction?.questBenefits ?? 0, Number(hasUnpaidUpkeep(unit, faction)));
export const unitDamage = (unit: Pick<Unit, 'attack' | 'kills' | 'weaponLevel'> & CulturalUnit & UpkeepUnit & Partial<Pick<Unit, 'faction' | 'raiderEquipmentMultiplier' | 'enemyStrengthMultiplier' | 'technologyBonus' | 'raiderBonus'>>, defense: number, faction?: CombatFaction, home = false): number =>
  rustEngine.combat_unit_damage(unit.kind === undefined ? -1 : UNIT_KIND_CODES[unit.kind], unit.attack, unit.kills ?? 0, unit.weaponLevel ?? 0,
    unit.raiderEquipmentMultiplier ?? 1, (unit.kind === 'archer' || unit.kind === 'horseArcher') ? archerDamageMultiplier(faction) : 1,
    Number(unit.faction === -2), unit.enemyStrengthMultiplier ?? 1, unit.technologyBonus?.attack ?? 0, unit.raiderBonus?.attack ?? 0, defense,
    faction?.achievements ?? 0, cultureContext(unit, home), faction?.questBenefits ?? 0, Number(hasUnpaidUpkeep(unit, faction)));
export const unitDefense = (unit: Pick<Unit, 'defense' | 'kills' | 'armorLevel'> & CulturalUnit & UpkeepUnit & Partial<Pick<Unit, 'raiderEquipmentMultiplier' | 'brace' | 'technologyBonus' | 'raiderBonus'>>, faction?: Pick<CombatFaction, 'achievements' | 'retinueFunded'>, home = false): number =>
  rustEngine.combat_unit_defense(unit.defense, unit.kills ?? 0, unit.armorLevel ?? 0, unit.raiderEquipmentMultiplier ?? 1,
    unit.brace?.defense ?? 0, unit.technologyBonus?.defense ?? 0, unit.raiderBonus?.defense ?? 0,
    faction?.achievements ?? 0, cultureContext(unit, home), Number(hasUnpaidUpkeep(unit, faction)));
export function recordKill(unit: Unit, experience = 1): void { unit.kills = rustEngine.combat_record_kill_amount(unit.kills ?? 0, experience); }

/** Compact rank emblems sit beside the helmet, clear of the face and health bar. */
export function drawVeterancy(c: CanvasRenderingContext2D, unit: Unit, x: number, y: number, size: number): void {
  drawRankMarker(c, veterancy(unit), x, y, size);
}
