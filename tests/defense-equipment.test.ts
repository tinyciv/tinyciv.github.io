import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { buildingArmor, buildingWeaponMultiplier, isDefensiveBuilding } from '../src/game/defense-equipment';
import { applyDefenseResearch } from '../src/game/defense-research';
import { purchaseBlacksmithUpgrade } from '../src/game/blacksmith';
import { updateWoodenTowers, woodenTowerAttack } from '../src/game/tower-combat';
import { updateGame } from '../src/game/simulation';
import { selectionSummary } from '../src/ui/selection-summary';
import type { Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const building = (id: number, kind: Building['kind'], x: number, y: number): Building =>
  ({ id, kind, x, y, faction: 0, hp: 600, maxHp: 600, armor: 6, capacity: 0 });
const unit = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit =>
  ({ id, kind, x, y, faction, hp: 100, maxHp: 100, morale: 100, attack: 30, defense: 4, speed: 0,
    range: kind === 'warrior' ? 1.1 : 4, order: 'hold', cooldown: 0, lastCombat: -60,
    moving: false, facing: 0, attackTime: 0 });
function fixture(): GameState {
  return { world: { width: 32, height: 24, seed: 'defense-equipment', source: 'test', spawns: [], revision: 1,
    tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
      moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ ...building(1, 'palace', 3, 10), governorPermissions: { farms: false, housing: false } },
      building(2, 'woodenTower', 12, 12), building(3, 'blacksmith', 12, 16)],
    units: [{ ...unit(10, 'leader', 12.5, 18.5), attack: 0 }],
    factions: [{ id: 0, name: 'Player', color: '#3988ff', affinity: 100, relation: 'self', food: 500,
      gold: 3000, production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 2, selectedType: 'building',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'defense-equipment', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 } };
}

describe('faction equipment on defensive buildings', () => {
  it.each(['palisade', 'wall', 'tower', 'woodenTower', 'guardPost', 'palace'] as const)
  ('uses current faction armor for %s without altering authored armor or health', kind => {
    const b = { ...building(2, kind, 12, 12), palaceLevel: 2 as const }, before = structuredClone(b);
    const owner = { armorLevel: 3 as const, weaponLevel: 2 as const };
    for (let repeat = 0; repeat < 4; repeat++) {
      expect(buildingArmor(b, owner)).toBe(kind === 'wall' ? 13.5 : 9);
      expect(buildingWeaponMultiplier(b, owner)).toBe(1.3);
    }
    expect(b).toEqual(before);
    expect(buildingArmor(b, undefined)).toBe(kind === 'wall' ? 9 : 6);
  });

  it.each(['palace', 'house', 'camp', 'library', 'blacksmith'] as const)
  ('leaves ordinary %s armor unmodified and respects explicit zero armor', kind => {
    const b = building(2, kind, 12, 12), owner = { armorLevel: 3 as const, weaponLevel: 3 as const };
    expect(isDefensiveBuilding(b)).toBe(false);
    expect(buildingArmor(b, owner)).toBe(6);
    expect(buildingWeaponMultiplier(b, owner)).toBe(1);
    expect(buildingArmor({ ...b, armor: 0 }, owner)).toBe(0);
  });

  it('purchases update existing/new/captured towers immediately and match the selection display', () => {
    const state = fixture(), tower = state.buildings[1], owner = state.factions[0];
    owner.gold = 9000;
    const baseline = { hp: tower.hp, maxHp: tower.maxHp, armor: tower.armor };
    for (let tier = 0; tier < 6; tier++) {
      expect(purchaseBlacksmithUpgrade(state, state.buildings[2], 'armor').ok).toBe(true);
      expect(purchaseBlacksmithUpgrade(state, state.buildings[2], 'weapon').ok).toBe(true);
    }
    expect(selectionSummary(state)).toMatchObject({ defense: expect.closeTo(12.6), attack: 18.375, showCombatStats: true });
    expect(tower).toMatchObject(baseline);
    expect(buildingArmor(building(4, 'woodenTower', 14, 12), owner)).toBeCloseTo(12.6);
    state.factions.push({ ...owner, id: 1, relation: 'war', armorLevel: 1, weaponLevel: 2 });
    tower.faction = 1;
    expect(buildingArmor(tower, state.factions[1])).toBeCloseTo(6.9);
    expect(woodenTowerAttack(tower, state.factions[1])).toBe(16.25);
    tower.faction = -1;
    expect(buildingArmor(tower, undefined)).toBe(6);
    expect(woodenTowerAttack(tower, undefined)).toBe(12.5);
  });

  it.each([4, 5, 6] as const)('applies tier %i to all defensive structures without multiplying their authored base twice', level => {
    const multiplier = { 4: 1.7, 5: 1.9, 6: 2.1 }[level];
    const owner = { armorLevel: level, weaponLevel: level };
    for (const kind of ['palisade', 'wall', 'tower', 'woodenTower', 'guardPost', 'palace'] as const) {
      const defense = { ...building(2, kind, 12, 12), palaceLevel: 2 as const };
      for (let repeat = 0; repeat < 3; repeat++) {
        expect(buildingArmor(defense, owner)).toBeCloseTo(6 * multiplier * (kind === 'wall' ? 1.5 : 1));
        expect(buildingWeaponMultiplier(defense, owner)).toBe(multiplier);
      }
      expect(defense.armor).toBe(6); expect(defense.hp).toBe(600);
    }
  });

  it('keeps research health independent of equipment and exposes Keep armor in the HUD', () => {
    const state = fixture(), owner = state.factions[0], tower = state.buildings[1];
    owner.armorLevel = 3; owner.research = { focus: 'reinforcedDefenses', levels: { reinforcedDefenses: 1 }, progress: {} };
    applyDefenseResearch(tower, owner);
    const maximum = tower.maxHp;
    expect(maximum).toBe(780);
    for (let i = 0; i < 4; i++) { expect(buildingArmor(tower, owner)).toBe(9); applyDefenseResearch(tower, owner); }
    expect(tower.maxHp).toBe(maximum); expect(tower.armor).toBe(6);
    state.selected = 1; state.buildings[0].palaceLevel = 2;
    expect(selectionSummary(state)).toMatchObject({ name: 'Keep', showCombatStats: true, defense: 9, attack: 8.75 });
  });

  it('tower shots use the current owner weapon tier exactly once', () => {
    const state = fixture(), tower = state.buildings[1], shots: number[] = [];
    state.factions[0].weaponLevel = 3;
    entityStore(state).units.add({ ...unit(20, 'warrior', 14.5, 12.5, 1), attack: 0 });
    const combat = { hostile: (a: number, b: number) => a !== b, clearShot: () => true,
      shoot: (_tower: Building, _from: unknown, _target: Unit, attack: number) => { shots.push(attack); } };
    updateWoodenTowers(state, .1, combat);
    state.factions.push({ ...state.factions[0], id: 1, weaponLevel: 1 });
    tower.faction = 1; state.units[1].faction = 0; tower.attackCooldown = 0;
    updateWoodenTowers(state, .1, combat);
    expect(shots).toHaveLength(2);
    expect(shots[0]).toBe(18.75); expect(shots[1]).toBeCloseTo(14.375);
  });

  it.each(['warrior', 'leader', 'archer'] as const)('applies building armor to actual %s attacks', kind => {
    const state = fixture(), tower = state.buildings[1];
    tower.attackCooldown = 99; state.factions[0].armorLevel = 3;
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war', armorLevel: 0 });
    const enemy = { ...unit(20, kind, 11.5, 12.5, 1), order: 'raid' as const, target: tower.id };
    entityStore(state).units.add(enemy);
    updateGame(state, .1, idle);
    const expected = (30 - 9) * .7;
    if (kind === 'warrior') expect(tower.hp).toBeCloseTo(600 - expected);
    else {
      const shot = state.projectiles?.find(p => p.attacker === enemy.id);
      expect(shot).toMatchObject({ target: tower.id });
      expect(shot!.damage).toBeCloseTo(expected);
      enemy.cooldown = 99; updateGame(state, .2, idle);
      expect(tower.hp).toBeCloseTo(600 - expected);
    }
  });
});
