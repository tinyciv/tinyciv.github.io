import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { setSoldierRole } from '../src/game/archery';
import { updateGame } from '../src/game/simulation';
import { recordRetinueKill, synchronizeRetinueSquads, joinRetinueSquad } from '../src/game/retinue-squads';
import { incomingUnitDamage, unitAttack, unitDamage, unitDefense, veterancy, VETERANCY_NAMES } from '../src/game/veterancy';
import type { EquipmentLevel, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
  id, kind, faction, x, y, hp: 100, maxHp: 100, morale: 100, attack: 17, defense: 4,
  speed: 0, range: kind === 'leader' || kind === 'archer' ? 4 : 1.1, order: 'hold', cooldown: 0,
  lastCombat: -60, lastDamagedAt: 0, moving: false, facing: 0, attackTime: 0,
});
function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'elite', source: 'test', spawns: [],
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 3, production: 0, gold: 1, variation: .5 })) },
    units: [{ ...person(10, 'leader', 3.5, 3.5), attack: 0 }],
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 2, y: 6, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'elite', rngState: 1,
    fields: [], marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 2 },
  };
}

describe('Hardened and Elite combat', () => {
  it('keeps Hardened at the former three-chevron strength and promotes Elite at 500 kills', () => {
    const unit = person(20, 'warrior', 10.5, 12.5);
    expect(VETERANCY_NAMES).toEqual(['Untrained', 'Regular', 'Veteran', 'Hardened', 'Elite']);
    for (const [kills, rank] of [[249, 2], [250, 3], [499, 3], [500, 4]]) {
      unit.kills = kills; expect(veterancy(unit)).toBe(rank);
    }
    unit.kills = 250;
    expect(unitDamage(unit, 4)).toBeCloseTo(17.5);
    expect(unitDefense(unit)).toBe(12);
  });

  it.each([
    { name: 'Untrained', kills: 0, attackBonus: 0, defenseBonus: 0 },
    { name: 'Regular', kills: 10, attackBonus: 3, defenseBonus: 2 },
    { name: 'Veteran', kills: 100, attackBonus: 7, defenseBonus: 5 },
    { name: 'Hardened', kills: 250, attackBonus: 12, defenseBonus: 8 },
  ])('grants equal $name attack and armor bonuses to warriors and archers at every equipment tier', ({ kills, attackBonus, defenseBonus }) => {
    for (const [tier, multiplier] of [[0, 1], [1, 1.15], [2, 1.3], [3, 1.5]] as const) {
      const warrior = { ...person(20, 'warrior', 10.5, 12.5), armorLevel: tier, weaponLevel: tier };
      const archer = { ...warrior }; setSoldierRole(archer, 'archer');
      const trainedWarrior = { ...warrior, kills }, trainedArcher = { ...archer, kills };
      // Role-specific base stats stay distinct; each rank adds the same benefit.
      expect(unitAttack(archer)).toBeCloseTo(unitAttack(warrior) * .8);
      expect(unitDefense(archer)).toBeCloseTo(unitDefense(warrior) * .5);
      for (const [ordinary, trained] of [[warrior, trainedWarrior], [archer, trainedArcher]]) {
        expect(unitAttack(trained) - unitAttack(ordinary)).toBeCloseTo(attackBonus * multiplier * .7);
        expect(unitDamage(trained, 4) - unitDamage(ordinary, 4)).toBeCloseTo(attackBonus * multiplier * .7);
        expect(unitDefense(trained) - unitDefense(ordinary)).toBeCloseTo(defenseBonus * multiplier);
      }
    }
  });

  it.each([0, 1, 2, 3] as EquipmentLevel[])('applies exact damage ratios against the equivalent untrained unit with equipment tier %i', equipment => {
    for (const kind of ['warrior', 'archer', 'leader'] as const) {
      const ordinary = { ...person(20, kind, 10.5, 12.5), armorLevel: equipment, weaponLevel: equipment };
      if (kind === 'archer') { ordinary.kind = 'warrior'; setSoldierRole(ordinary, 'archer'); }
      const elite = { ...ordinary, kills: 500 };
      for (const defense of [0, 4, 12, 100])
        expect(unitDamage(elite, defense)).toBeCloseTo(unitDamage(ordinary, defense) * 2.3);
      for (const attack of [5, 17, 100]) {
        const enemy = { attack };
        expect(incomingUnitDamage(elite, unitDamage(enemy, unitDefense(elite))))
          .toBeCloseTo(unitDamage(enemy, unitDefense(ordinary)) * .15);
      }
    }
  });

  it('preserves the benchmark 130% extra dealt and 85% less taken without stacking Hardened bonuses', () => {
    const ordinary = person(20, 'warrior', 10.5, 12.5), elite = { ...ordinary, kills: 500 };
    expect(unitDamage(elite, unitDefense(ordinary))).toBeCloseTo(20.93);
    expect(incomingUnitDamage(elite, unitDamage(ordinary, unitDefense(elite)))).toBeCloseTo(1.365);
    const scout = { ...elite }; setSoldierRole(scout, 'scout');
    expect(unitDamage(scout, 0)).toBe(0);
  });

  it.each([false, true])('applies resistance once in real melee combat (Elite attacker: %s)', eliteAttacker => {
    const state = fixture();
    const attacker = { ...person(20, 'warrior', 16.5, 12.5, -2), kills: eliteAttacker ? 500 : 0 };
    const target = { ...person(21, 'warrior', 17.5, 12.5), kills: 500, attack: 0 };
    entityStore(state).units.add(attacker, target);
    updateGame(state, .1, idle);
    expect(target.hp).toBeCloseTo(100 - 1.365 * .85 * (eliteAttacker ? 2.3 : 1));
    expect(target.lastDamagedAt).toBeCloseTo(.1);
  });

  it.each(['leader', 'archer'] as const)('applies outgoing and incoming effects once for an actual %s projectile', kind => {
    const state = fixture(), attacker = { ...person(20, kind, 14.5, 12.5), kills: 500 };
    const target = { ...person(21, 'warrior', 18.5, 12.5, -2), kills: 500, attack: 0 };
    entityStore(state).units.add(attacker, target);
    updateGame(state, .05, idle);
    const shot = state.projectiles?.find(projectile => projectile.attacker === attacker.id);
    expect(shot).toBeDefined();
    expect(shot!.damage).toBeCloseTo(20.93);
    expect(target.hp).toBe(100);
    attacker.attack = 0;
    updateGame(state, .4, idle);
    expect(target.hp).toBeCloseTo(100 - 20.93 * .15);
    expect(state.projectiles).toHaveLength(0);
  });

  it('also protects Elite units against real tower projectiles', () => {
    const state = fixture(), target = { ...person(20, 'warrior', 17.5, 12.5), kills: 500, attack: 0 };
    entityStore(state).units.add(target);
    entityStore(state).buildings.add({ id: 40, kind: 'woodenTower', faction: -2, x: 14, y: 12, hp: 600, maxHp: 600, capacity: 0 });
    updateGame(state, .05, idle);
    expect(state.projectiles?.some(projectile => projectile.attacker === 40)).toBe(true);
    updateGame(state, .3, idle);
    expect(target.hp).toBeCloseTo(100 - (12.5 - 4) * .7 * .15);
  });

  it('promotes all squad members together and passes Elite to a replacement', () => {
    const state = fixture(), first = { ...person(20, 'warrior', 14.5, 12.5), kills: 499 };
    const second = person(21, 'warrior', 15.5, 12.5), third = person(22, 'warrior', 16.5, 12.5);
    entityStore(state).units.add(first, second, third); synchronizeRetinueSquads(state);
    expect([first, second, third].map(veterancy)).toEqual([3, 3, 3]);
    recordRetinueKill(state, second);
    expect([first, second, third].map(veterancy)).toEqual([4, 4, 4]);
    first.hp = second.hp = 0;
    const replacement = person(23, 'warrior', 4.5, 7.5);
    entityStore(state).units.add(replacement); joinRetinueSquad(state, replacement);
    expect(replacement.retinueSquad).toBe(third.retinueSquad);
    expect(veterancy(replacement)).toBe(4);
    expect(incomingUnitDamage(replacement, 10)).toBeCloseTo(1.5);
  });
});
