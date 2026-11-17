import { describe, expect, it } from 'vitest';
import { fixture, building, person } from './helpers/research-income';
import { entityStore } from '../src/game/entity-store';
import { updateWellUpgrades } from '../src/game/wells';
import { grantIncome } from '../src/game/resource-income';
import { libraryResearchMultiplier, libraryPlacementAllowed, updateResearch, researchCost, RESEARCH_BRANCHES } from '../src/game/research';
import { blacksmithUpgradeStatus, purchaseBlacksmithUpgrade } from '../src/game/blacksmith';
import { markWorldChanged } from '../src/game/world-revisions';
import { leaderAttackAura } from '../src/game/leader-aura';
import { initialLeaderProgression, awardLeaderXp, leaderXpRequired, learnLeaderSkill } from '../src/game/leader-progression';
import { updateGame, validateBuildAt } from '../src/game/simulation';
import { unitDamage, attackDamage } from '../src/game/veterancy';
import { BALLISTA_ATTACK } from '../src/game/ballista';
import { buildingArmor } from '../src/game/defense-equipment';

const idle = { up: false, down: false, left: false, right: false };
const reserve = (state: ReturnType<typeof fixture>) => (state.factions[0].research?.credit ?? 0) + (state.factions[0].research?.funding ?? []).reduce((n, f) => n + f.points, 0);

describe('delayed house improvements', () => {
  it('waits fifteen game seconds, pays once, and cancels when the well is lost', () => {
    const state = fixture(), owner = state.factions[0];
    owner.research = { levels: {}, progress: {}, focus: 'wall', allocation: 0 };
    const home = { ...building(30, 'house', 8, 8), houseLevel: 1 }, well = building(31, 'well', 9, 8);
    entityStore(state).buildings.add(home, well);
    updateWellUpgrades(state); expect(home).toMatchObject({ houseLevel: 1, houseUpgradeAt: 15 });
    state.time = 14.99; updateWellUpgrades(state); expect(home.houseLevel).toBe(1);
    well.hp = 0; updateWellUpgrades(state); expect(home.houseUpgradeAt).toBeUndefined();
    well.hp = 250; state.time = 20; updateWellUpgrades(state); expect(home.houseUpgradeAt).toBe(35);
    state.time = 35; updateWellUpgrades(state);
    expect(home).toMatchObject({ houseLevel: 2, hp: 290, maxHp: 290 });
    expect(owner.gold).toBe(2003); expect(state.particles.at(-1)?.text).toBe('+3 gold');
    state.time = 100; updateWellUpgrades(state); expect(owner.gold).toBe(2003);
  });
});

describe('city libraries', () => {
  it('counts each completed city once, applies diminishing increments, and rejects duplicate footprints', () => {
    const state = fixture();
    expect(libraryResearchMultiplier(state, 0)).toBe(1);
    expect(libraryPlacementAllowed(state, 0, {x: 9, y: 8})).toBe(false);
    expect(validateBuildAt(state, 'library', 8, 7).message).toContain('one library');
    entityStore(state).buildings.add(building(50, 'library', 8, 8));
    expect(libraryResearchMultiplier(state, 0)).toBe(1);
    const expected = [1.30, 1.50, 1.64, 1.73, 1.79, 1.83];
    expected.forEach((value, i) => {
      const x = 30 + i * 20;
      entityStore(state).buildings.add(building(100 + i * 2, 'palace', x, 10), building(101 + i * 2, 'library', x, 13));
      expect(libraryResearchMultiplier(state, 0)).toBeCloseTo(value);
    });
    const last = state.buildings.at(-1)!; last.construction = { startedAt: 0, duration: 20 };
    expect(libraryResearchMultiplier(state, 0)).toBeCloseTo(1.79);
  });
  it('buys extra Science without extra spending and never refunds bonus Science as gold', () => {
    const state = fixture(), owner = state.factions[0];
    entityStore(state).buildings.add(building(30, 'palace', 25, 10), building(31, 'library', 25, 13));
    grantIncome(owner, { gold: 100 }, state);
    expect(owner.gold).toBe(2075); expect(reserve(state)).toBeCloseTo(32.5);
    for (const branch of RESEARCH_BRANCHES) owner.research!.levels[branch.id] = 1;
    updateResearch(state, .1); expect(reserve(state)).toBeCloseTo(0); expect(owner.gold).toBeCloseTo(2100);
  });
  it('caps the charge at the unfinished Science divided by efficiency', () => {
    const state = fixture(), owner = state.factions[0];
    entityStore(state).buildings.add(building(30, 'palace', 25, 10), building(31, 'library', 25, 13));
    owner.research = { levels: Object.fromEntries(RESEARCH_BRANCHES.filter(b => b.id !== 'woodenTower').map(b => [b.id, 1])), progress: {}, focus: 'woodenTower', allocation: 1 };
    const needed = researchCost(owner, 'woodenTower'); grantIncome(owner, {gold: 100}, state);
    expect(reserve(state)).toBeCloseTo(needed); expect(owner.gold).toBeCloseTo(2100 - needed / 1.3);
  });
});

describe('equipment iron and command aura', () => {
  it('requires three additional developed tiles for each purchase across both tracks', () => {
    const state = fixture(), smith = building(30, 'blacksmith', 10, 12); entityStore(state).buildings.add(smith);
    state.factions[0].gold = 10000;
    const addIron = (x: number, y: number) => Object.assign(state.world.tiles[y * state.world.width + x], { resource: 'iron', resourceDeveloped: true });
    for (let y = 8; y <= 10; y++) addIron(5, y);
    markWorldChanged(state.world, 'appearance');
    expect(blacksmithUpgradeStatus(state, smith, 'armor')).toMatchObject({ironControlled: 3, ironRequired: 3, available: true});
    expect(purchaseBlacksmithUpgrade(state, smith, 'armor').ok).toBe(true);
    expect(blacksmithUpgradeStatus(state, smith, 'weapon')).toMatchObject({ironRequired: 6, available: false});
    for (let y = 8; y <= 10; y++) addIron(4, y);
    markWorldChanged(state.world, 'appearance');
    expect(purchaseBlacksmithUpgrade(state, smith, 'weapon').ok).toBe(true);
    expect(blacksmithUpgradeStatus(state, smith, 'armor').ironRequired).toBe(9);
  });
  it('halves personal attack upgrades and buffs only soldiers within six tiles', () => {
    const state = fixture(), leader = state.units[0], soldier = state.units[1], before = leader.attack;
    awardLeaderXp(state, leaderXpRequired(1)); expect(leader.attack).toBe(before + .25);
    expect(learnLeaderSkill(state, 'power').ok).toBe(true); expect(leader.attack).toBe(before + .75);
    expect(leaderAttackAura(state, soldier)).toBeCloseTo(1.04);
    soldier.x = leader.x + 6; soldier.y = leader.y; expect(leaderAttackAura(state, soldier)).toBeCloseTo(1.04);
    soldier.x += .001; expect(leaderAttackAura(state, soldier)).toBe(1);
    expect(leaderAttackAura(state, leader)).toBe(1);
    expect(leaderAttackAura(state, {...soldier, kind: 'worker'})).toBe(1);
    leader.hp = 0; soldier.x = leader.x; expect(leaderAttackAura(state, soldier)).toBe(1);
  });
  it.each(['warrior', 'archer'] as const)('applies the aura to actual %s attacks', kind => {
    const state = fixture(), leader = state.units[0], soldier = state.units[1];
    leader.leaderProgression = {...initialLeaderProgression(), level: 10}; leader.attack = 0;
    Object.assign(soldier, { kind, range: kind === 'archer' ? 4 : 1.1, x: 14.5, y: 15.5, order: 'hold', retinueStance: 'hold' });
    Object.assign(leader, { x: 12.5, y: 15.5 });
    const enemy = {...person(50, 'warrior', kind === 'archer' ? 17.5 : 15.5, 15.5, -2), hp: 1000, maxHp: 1000, attack: 0, cooldown: 100};
    entityStore(state).units.add(enemy);
    updateGame(state, .1, idle);
    const expected = unitDamage(soldier, enemy.defense, state.factions[0]) * 1.2;
    if (kind === 'archer') expect(state.projectiles?.find(p => p.attacker === soldier.id)?.damage).toBeCloseTo(expected);
    else expect(1000 - enemy.hp).toBeCloseTo(expected);
  });
  it.each(['wall', 'palisade', 'woodenTower'] as const)('ballista hits %s with the correct wall multiplier', kind => {
    const state = fixture(); entityStore(state).units.replace([]);
    entityStore(state).buildings.add(building(40, 'house', 18, 15, -2), building(41, 'house', 18, 16, -2));
    const engine = building(30, 'ballista', 12, 15), target = {...building(31, kind, 17, 15, -2), hp: 10000, maxHp: 10000};
    entityStore(state).buildings.add(engine, target);
    updateGame(state, .1, idle);
    const shot = state.projectiles?.find(p => p.attacker === engine.id);
    expect(shot?.damage).toBeCloseTo(attackDamage(BALLISTA_ATTACK, buildingArmor(target, undefined)) * (kind === 'woodenTower' ? 1 : 2));
  });
});
