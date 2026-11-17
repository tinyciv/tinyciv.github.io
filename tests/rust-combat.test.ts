import { describe, expect, it } from 'vitest';
import { rustEngine } from '../src/game/rust-engine';
import { EQUIPMENT_MULTIPLIERS, equipmentMultiplier, MAX_EQUIPMENT_LEVEL } from '../src/game/equipment';
import { RAIDER_ATTACK_MULTIPLIER } from '../src/game/raider-pressure';
import { attackDamage, incomingUnitDamage, unitAttack, unitDamage, unitDefense, veterancy, VETERANCY_KILLS } from '../src/game/veterancy';
import type { Faction, Unit } from '../src/game/types';

const fletching: Pick<Faction, 'research'> = { research: { focus: 'fletching', levels: { fletching: 1 }, progress: {} } };

describe('Rust combat rules through the browser bridge', () => {
  it('exposes one canonical equipment/rank table to both the engine and interface', () => {
    expect(VETERANCY_KILLS).toEqual([10, 100, 250, 500]);
    expect(EQUIPMENT_MULTIPLIERS).toEqual([1, 1.15, 1.3, 1.5, 1.7, 1.9, 2.1]);
    expect(MAX_EQUIPMENT_LEVEL).toBe(6);
    expect(RAIDER_ATTACK_MULTIPLIER).toBe(.85);
    for (let level = 0; level <= MAX_EQUIPMENT_LEVEL; level++)
      expect(rustEngine.combat_equipment_multiplier(level)).toBe(equipmentMultiplier(level as Unit['weaponLevel']));
  });

  it('preserves effective attack, armored damage, brace, and research on an equipped veteran archer', () => {
    const archer = { kind: 'archer' as const, attack: 17, defense: 4, kills: 100, weaponLevel: 3 as const, armorLevel: 1 as const,
      faction: -2, raiderEquipmentMultiplier: 1.2, enemyStrengthMultiplier: 1.5,
      technologyBonus: { attack: 2, defense: 2 }, raiderBonus: { attack: 3, defense: 1 }, brace: { x: 0, y: 0, stillFor: 10, defense: 6 } };
    expect(veterancy(archer)).toBe(2);
    expect(unitAttack(archer, fletching)).toBeCloseTo(49.3394, 10);
    expect(unitDamage(archer, 12, fletching)).toBeCloseTo(37.0229, 10);
    expect(unitDefense(archer)).toBeCloseTo(21.42, 10);
    expect(incomingUnitDamage(archer, 20)).toBe(20);
  });

  it('replaces additive ranks with Elite multipliers without stacking either armor or effective bonuses', () => {
    const archer = { kind: 'horseArcher' as const, attack: 17, defense: 4, kills: 500, weaponLevel: 6 as const, armorLevel: 6 as const,
      faction: -2, raiderEquipmentMultiplier: 1.6, enemyStrengthMultiplier: 1.5,
      technologyBonus: { attack: 2, defense: 2 }, raiderBonus: { attack: 3, defense: 3 }, brace: { x: 0, y: 0, stillFor: 10, defense: 6 } };
    expect(veterancy(archer)).toBe(4);
    expect(unitAttack(archer, fletching)).toBeCloseTo(139.841042, 10);
    expect(unitDamage(archer, 12, fletching)).toBeCloseTo(111.513092, 10);
    expect(unitDefense(archer)).toBeCloseTo(24.44, 10);
    expect(incomingUnitDamage(archer, 20)).toBe(3);
  });

  it('keeps minimum hits after armor and prevents equipped scouts from inflicting damage', () => {
    expect(attackDamage(1, 1000)).toBeCloseTo(2.8);
    expect(unitDamage({ kind: 'scout', attack: 100, kills: 500, weaponLevel: 6, technologyBonus: { attack: 20, defense: 20 } }, 0)).toBe(0);
    expect(incomingUnitDamage({ kills: 500 }, -20)).toBe(0);
    expect(attackDamage(Number.NaN, 4)).toBeNaN();
  });
});
