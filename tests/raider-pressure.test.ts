import { describe, expect, it } from 'vitest';
import { RAIDER_ATTACK_MULTIPLIER, raiderEquipmentMultiplier, raiderWaveInterval, updateRaiderEquipment } from '../src/game/raider-pressure';
import { unitAttack, unitDamage, unitDefense } from '../src/game/veterancy';
import type { Unit } from '../src/game/types';

describe('raider equipment and frequency escalation', () => {
  it('reduces every raider hit once by fifteen percent after armor, independent of source and equipment', () => {
    const sources = [
      { kind: 'warrior', attack: 10 }, // Wilderness.
      { kind: 'warrior', attack: 6, marauderPack: 1 }, // Opening camp wave.
      { kind: 'warrior', attack: 14, marauderPack: 2, marauderLeader: true, kills: 100 },
      { kind: 'archer', attack: 11.2, marauderPack: 3, raiderEquipmentMultiplier: 1.6 },
      { kind: 'warrior', attack: 8, marauderPack: 4, raiderGarrison: 10 }, // Camp defense/reserve.
      { kind: 'warrior', attack: 14, kills: 500, weaponLevel: 3, raiderEquipmentMultiplier: 1.6 },
    ] as Partial<Unit>[];
    expect(RAIDER_ATTACK_MULTIPLIER).toBe(.85);
    for (const source of sources) {
      const ordinary = { ...source, faction: 1, defense: 4 } as Unit;
      const raider = { ...ordinary, faction: -2 };
      expect(unitAttack(raider)).toBeCloseTo(unitAttack(ordinary) * .85);
      expect(unitDefense(raider)).toBe(unitDefense(ordinary));
      for (const armor of [0, 5, 1000]) expect(unitDamage(raider, armor)).toBeCloseTo(unitDamage(ordinary, armor) * .85);
      expect(unitAttack({ ...ordinary, faction: 0 })).toBe(unitAttack(ordinary));
    }
  });
  it('retains the independent 1.6× cap at fifteen minutes despite reduced blacksmith upgrades', () => {
    for (const [time, multiplier] of [[0, 1], [225, 1.15], [450, 1.3], [675, 1.45], [900, 1.6], [1800, 1.6]])
      expect(raiderEquipmentMultiplier(time)).toBeCloseTo(multiplier);
    expect(raiderEquipmentMultiplier(-10)).toBe(1);
    expect(raiderEquipmentMultiplier(Number.NaN)).toBe(1);
  });

  it('increases attack frequency independently of bounded party size', () => {
    expect([0, 450, 900, 7200].map(raiderWaveInterval)).toEqual([26, 20, 14, 14]);
  });

  it('upgrades living veterans, leaders, archers and new recruits without compounding or changing base stats', () => {
    const units = [
      { id: 1, faction: -2, kind: 'warrior', hp: 70, attack: 14, defense: 2, kills: 10, marauderLeader: true },
      { id: 2, faction: -2, kind: 'archer', hp: 50, attack: 11, defense: 1, kills: 100 },
      { id: 3, faction: 0, kind: 'warrior', hp: 100, attack: 20, defense: 4 },
    ] as Unit[];
    const state = { units, time: 0 };
    const attacks = units.map(unit => unitAttack(unit)), defenses = units.map(unitDefense);
    state.time = 450; updateRaiderEquipment(state); updateRaiderEquipment(state);
    for (const index of [0, 1]) {
      expect(unitAttack(units[index])).toBeCloseTo(attacks[index] * 1.3);
      expect(unitDefense(units[index])).toBeCloseTo(defenses[index] * 1.3);
    }
    expect(units[0]).toMatchObject({ hp: 70, attack: 14, defense: 2, kills: 10 });
    expect(units[2].raiderEquipmentMultiplier).toBeUndefined();
    expect(unitAttack(units[2])).toBe(attacks[2]);
    state.time = 900; updateRaiderEquipment(state);
    expect(unitAttack(units[0])).toBeCloseTo(attacks[0] * 1.6);
    expect(unitDefense(units[1])).toBeCloseTo(defenses[1] * 1.6);
    units.push({ ...units[0], id: 4, raiderEquipmentMultiplier: undefined });
    state.time = 1800; updateRaiderEquipment(state);
    expect(unitAttack(units[3])).toBe(unitAttack(units[0]));
  });
});
