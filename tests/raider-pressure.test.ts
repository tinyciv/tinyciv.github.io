import { describe, expect, it } from 'vitest';
import { RAIDER_ATTACK_MULTIPLIER, raiderPartySize, raiderPartySizeMultiplier } from '../src/game/raider-pressure';
import { raidArcherFraction, raidEquipment, raidProfile } from '../src/game/raid-director';
import { fogRaidProfile } from '../src/game/fog-raids';
import { unitAttack, unitDamage, unitDefense } from '../src/game/veterancy';
import type { Unit } from '../src/game/types';

describe('raider strength', () => {
  it('reduces early camp defender sorties once, then restores full strength gradually', () => {
    expect([0, 60, 300, 600, 900, 7200].map(raiderPartySizeMultiplier)).toEqual([.6, .6, .6, .8, 1, 1]);
    expect([0, 60, 300, 600, 900, 7200].map(time => raiderPartySize(30, time))).toEqual([18, 18, 18, 24, 30, 30]);
    expect([1, 2, 3, 4, 5].map(count => raiderPartySize(count, 0))).toEqual([1, 1, 2, 2, 3]);
    expect(raiderPartySize(0, 0)).toBe(0);
    expect(raiderPartySize(30, Number.NaN)).toBe(18);
  });
  it('reduces every raider hit once by fifteen percent after armor, independent of source and equipment', () => {
    const sources = [
      { kind: 'warrior', attack: 10 }, // Wilderness.
      { kind: 'warrior', attack: 6, marauderPack: 1 }, // Opening camp raid.
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
  it('steps equipment by whole progress eras up to the 1.6× cap', () => {
    for (const [era, multiplier] of [[0, 1], [.9, 1], [1, 1.1], [3.5, 1.3], [6, 1.6], [9, 1.6], [-1, 1]])
      expect(raidEquipment(era)).toBeCloseTo(multiplier);
  });
  it('grows raider stats and archer share with era alone', () => {
    let previous = raidProfile(0);
    expect(previous).toEqual({ hp: 40, attack: 6, defense: 1 });
    for (let era = .5; era <= 6; era += .5) {
      const next = raidProfile(era);
      expect(next.hp).toBeGreaterThanOrEqual(previous.hp);
      expect(next.attack).toBeGreaterThanOrEqual(previous.attack);
      expect(next.defense).toBeGreaterThanOrEqual(previous.defense);
      previous = next;
    }
    expect(raidProfile(6)).toEqual({ hp: 110, attack: 17, defense: 3 });
    // The marauder halving still applies on top of the era stats.
    expect(fogRaidProfile(0)).toEqual({ hp: 70, attack: (6 + 17 / .85) / 2, defense: 2.5 });
    expect([0, 1, 2, 4].map(raidArcherFraction)).toEqual([0, .1, .2, .2]);
  });
});
