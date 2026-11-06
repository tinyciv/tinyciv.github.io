import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { applyFactionEquipment, blacksmithUpgradeStatus, purchaseBlacksmithUpgrade } from '../src/game/blacksmith';
import { buildingActivityAvailable } from '../src/game/building-activity';
import { canWalk } from '../src/game/pathfinding';
import { buildAt, cancelConstruction, diplomacyAction, respawnLeader, updateGame, validateBuildAt } from '../src/game/simulation';
import { updateConstruction } from '../src/game/structures';
import { updateWoodenTowers, WOODEN_TOWER_ATTACK } from '../src/game/tower-combat';
import { buildingSize, type Building, type EquipmentLevel, type GameState, type Unit } from '../src/game/types';
import { unitAttack, unitDamage, unitDefense } from '../src/game/veterancy';
import { equipmentMultiplier } from '../src/game/equipment';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
  id, kind, faction, x, y, hp: 100, morale: 100, attack: kind === 'leader' ? 25 : 17,
  defense: kind === 'leader' ? 5 : 4, speed: 3.6, range: kind === 'leader' ? 4 : 1.1,
  order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({
  id, kind, faction, x, y, hp: 250, maxHp: 250, capacity: 0,
});
function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'blacksmith', source: 'test', spawns: [],
      tiles: Array.from({ length: 32 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ ...building(1, 'palace', 6, 10), governorPermissions: { farms: false, housing: false } }, building(2, 'blacksmith', 12, 10)],
    units: [unit(10, 'leader', 12.5, 13.5), unit(11, 'warrior', 15.5, 13.5)],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 2000,
      production: 0, population: 4, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false, research: { focus: 'blacksmith', levels: { blacksmith: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'blacksmith', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
  };
}

describe('blacksmith construction', () => {
  it('reserves one tile for 200 gold and sends a palace builder for 90 seconds of work', () => {
    const state = fixture(); entityStore(state).buildings.replace(state.buildings.slice(0, -1)); state.factions[0].gold = 199;
    expect(buildAt(state, 'blacksmith', 12, 10)).toMatchObject({ ok: false, message: 'Need 200 gold.' });
    expect(state.factions[0].gold).toBe(199);
    state.factions[0].gold = 200;
    expect(buildAt(state, 'blacksmith', 12, 10).ok).toBe(true);
    const smithy = state.buildings.find(candidate => candidate.kind === 'blacksmith')!;
    expect(state.factions[0].gold).toBe(0); expect(buildingSize(smithy)).toBe(1);
    expect(smithy.construction).toMatchObject({ duration: 90, paidGold: 200, waitingForBuilder: true });
    expect(buildingActivityAvailable(state, smithy)).toBe(false);
    for (let step = 0; step < 150 && smithy.construction!.waitingForBuilder; step++) updateGame(state, .1, idle);
    const site = smithy.construction!;
    expect(site.waitingForBuilder).toBe(false);
    expect(state.units.find(candidate => candidate.id === site.builderId)).toMatchObject({ builder: true, buildPhase: 'working' });
    state.time = site.startedAt + 89.99; updateConstruction(state);
    expect(smithy.construction).toBeDefined();
    state.time = site.startedAt + 90; updateConstruction(state);
    expect(smithy.construction).toBeUndefined();
    expect(canWalk(state, 12.5, 10.5, 0)).toBe(false);
    expect(canWalk(state, 13.5, 10.5, 0)).toBe(true);
    expect(buildingActivityAvailable(state, smithy)).toBe(true);
  });

  it('uses normal border, occupancy, house-clearance, and refund rules', () => {
    const state = fixture(); entityStore(state).buildings.replace(state.buildings.slice(0, -1));
    expect(validateBuildAt(state, 'blacksmith', 20, 10).message).toContain('borders');
    entityStore(state).buildings.add(building(3, 'house', 11, 10));
    expect(validateBuildAt(state, 'blacksmith', 11, 10).message).toContain('occupied');
    expect(validateBuildAt(state, 'blacksmith', 12, 10).message).toContain('walking lane');
    entityStore(state).buildings.replace(state.buildings.slice(0, -1));
    expect(buildAt(state, 'blacksmith', 12, 10).ok).toBe(true);
    const smithy = state.buildings.find(candidate => candidate.kind === 'blacksmith')!;
    expect(cancelConstruction(state, smithy.id)).toMatchObject({ ok: true, refund: 200 });
    expect(state.factions[0].gold).toBe(2000);
  });
});

describe('blacksmith equipment research', () => {
  it('purchases six independent faction-wide tiers without compounding or changing base stats', () => {
    const state = fixture(), smithy = state.buildings[1], leader = state.units[0], warrior = state.units[1];
    state.factions[0].gold = 9000;
    warrior.kills = 100;
    const worker = { ...unit(12, 'worker', 14.5, 15.5), attack: 0, defense: 0 };
    const foreign = unit(13, 'warrior', 28.5, 20.5, 1);
    entityStore(state).units.add(worker, foreign);
    const beforeWorker = structuredClone(worker), beforeForeign = structuredClone(foreign);
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const multiplier = [1, 1.15, 1.3, 1.5, 1.7, 1.9, 2.1][level];
      expect(blacksmithUpgradeStatus(state, smithy, 'armor')).toMatchObject({
        level: level - 1, nextLevel: level, multiplier, cost: level * 200, available: true,
      });
      expect(purchaseBlacksmithUpgrade(state, smithy, 'armor').ok).toBe(true);
      expect(unitDefense(leader)).toBe(5 * multiplier);
      expect(unitDefense(warrior)).toBe(9 * multiplier);
      expect(unitAttack(warrior)).toBeCloseTo(24 * .7);
    }
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const multiplier = [1, 1.15, 1.3, 1.5, 1.7, 1.9, 2.1][level];
      expect(purchaseBlacksmithUpgrade(state, smithy, 'weapon').ok).toBe(true);
      expect(unitAttack(leader)).toBeCloseTo(25 * multiplier * .7);
      expect(unitDamage(warrior, 5)).toBeCloseTo((24 * multiplier - 5) * .7);
    }
    expect(state.factions[0]).toMatchObject({ armorLevel: 6, weaponLevel: 6, gold: 600 });
    expect(leader).toMatchObject({ attack: 25, defense: 5, armorLevel: 6, weaponLevel: 6 });
    expect(warrior).toMatchObject({ attack: 17, defense: 4, kills: 100 });
    expect(worker).toEqual(beforeWorker); expect(foreign).toEqual(beforeForeign);
    expect(blacksmithUpgradeStatus(state, smithy, 'armor')).toMatchObject({
      level: 6, nextLevel: null, currentMultiplier: 2.1, multiplier: 2.1, cost: null, available: false,
    });
    const before = structuredClone(state);
    expect(purchaseBlacksmithUpgrade(state, smithy, 'armor').ok).toBe(false);
    expect(purchaseBlacksmithUpgrade(state, smithy, 'weapon').ok).toBe(false);
    expect(state).toEqual(before);
  });

  it.each([4, 5, 6] as const)('requires the full tier-%i payment and never double-charges a failed purchase', level => {
    const state = fixture(), smithy = state.buildings[1];
    state.factions[0].armorLevel = level - 1 as EquipmentLevel;
    state.factions[0].gold = level * 200 - 1;
    const before = structuredClone(state);
    expect(blacksmithUpgradeStatus(state, smithy, 'armor')).toMatchObject({ level: level - 1, nextLevel: level,
      cost: level * 200, available: false, reason: `Need ${level * 200} gold.` });
    expect(purchaseBlacksmithUpgrade(state, smithy, 'armor').ok).toBe(false);
    expect(state).toEqual(before);
    state.factions[0].gold++;
    expect(purchaseBlacksmithUpgrade(state, smithy, 'armor').ok).toBe(true);
    expect(state.factions[0].armorLevel).toBe(level); expect(state.factions[0].gold).toBe(0);
    expect(purchaseBlacksmithUpgrade(state, smithy, 'armor').ok).toBe(false);
    expect(state.factions[0].gold).toBe(0);
  });

  it.each(['archer', 'spearman', 'horseman'] as const)('issues tier VI to existing %s retinue without resetting their role or wounds', kind => {
    const state = fixture(), soldier = { ...unit(30, kind, 13, 13), hp: 37, kills: 100 };
    entityStore(state).units.add(soldier);
    Object.assign(state.factions[0], { armorLevel: 6, weaponLevel: 6 });
    applyFactionEquipment(state, 0);
    expect(soldier).toMatchObject({ kind, hp: 37, kills: 100, armorLevel: 6, weaponLevel: 6 });
    expect(unitDefense(soldier)).toBeCloseTo(9 * 2.1);
    expect(unitAttack(soldier)).toBeCloseTo(24 * 2.1 * .7);
  });

  it.each(['poor', 'enemy', 'wrong building', 'removed', 'unfinished', 'destroyed', 'distant Leader', 'dead Leader', 'hidden Leader', 'defeat'] as const)
  ('rejects an invalid upgrade without mutation: %s', reason => {
    const state = fixture(), smithy = state.buildings[1], leader = state.units[0];
    if (reason === 'poor') state.factions[0].gold = 199;
    if (reason === 'enemy') smithy.faction = 1;
    if (reason === 'wrong building') entityStore(state).setBuildingKind(smithy, 'palace');
    if (reason === 'removed') entityStore(state).buildings.replace(state.buildings.slice(0, -1));
    if (reason === 'unfinished') smithy.construction = { startedAt: 0, duration: 90 };
    if (reason === 'destroyed') smithy.hp = 0;
    if (reason === 'distant Leader') leader.y = 14.01;
    if (reason === 'dead Leader') leader.hp = 0;
    if (reason === 'hidden Leader') leader.inside = true;
    if (reason === 'defeat') state.gameOver = true;
    const before = structuredClone(state);
    expect(blacksmithUpgradeStatus(state, smithy, 'weapon').available).toBe(false);
    expect(purchaseBlacksmithUpgrade(state, smithy, 'armor').ok).toBe(false);
    expect(purchaseBlacksmithUpgrade(state, smithy, 'weapon').ok).toBe(false);
    expect(state).toEqual(before);
  });

  it('accepts exactly three tiles of reach, shares tiers across smithies, and keeps research if a smithy is lost', () => {
    const state = fixture(), first = state.buildings[1]; state.units[0].y = 14;
    expect(purchaseBlacksmithUpgrade(state, first, 'armor').ok).toBe(true);
    const second = building(3, 'blacksmith', 13, 10); entityStore(state).buildings.add(second);
    state.units[0].x = 13.5;
    expect(blacksmithUpgradeStatus(state, second, 'armor')).toMatchObject({ level: 1, nextLevel: 2, cost: 400 });
    first.hp = 0;
    expect(unitDefense(state.units[0])).toBe(5.75);
    expect(purchaseBlacksmithUpgrade(state, second, 'armor').ok).toBe(true);
    expect(unitDefense(state.units[0])).toBe(6.5);
  });

  it('equips new palace recruits and a fresh respawned Leader without giving them veterancy', () => {
    const state = fixture(), smithy = state.buildings[1];
    state.factions[0].gold = 9000;
    for (let tier = 0; tier < 6; tier++) {
      expect(purchaseBlacksmithUpgrade(state, smithy, 'armor').ok).toBe(true);
      expect(purchaseBlacksmithUpgrade(state, smithy, 'weapon').ok).toBe(true);
    }
    state.factions[0].nextRetinueAt = 0;
    const ids = new Set(state.units.map(candidate => candidate.id)); updateGame(state, .1, idle);
    const recruit = state.units.find(candidate => candidate.kind === 'warrior' && !ids.has(candidate.id))!;
    expect(recruit).toMatchObject({ armorLevel: 6, weaponLevel: 6, joiningRetinue: true });
    expect(recruit.kills ?? 0).toBe(0);
    expect(unitDefense(recruit)).toBe(8.4); expect(unitAttack(recruit)).toBeCloseTo(24.99);
    state.units[0].hp = 0; state.units[0].kills = 350; state.gameOver = true; state.factions[0].defeated = true;
    const replacement = respawnLeader(state).leader!;
    expect(replacement).toMatchObject({ armorLevel: 6, weaponLevel: 6, kills: 0 });
    expect(unitDefense(replacement)).toBe(10.5); expect(unitAttack(replacement)).toBeCloseTo(36.75);
  });

  it('issues the realm’s equipment to soldiers joining through confederation', () => {
    const state = fixture(); state.factions[0].armorLevel = 5; state.factions[0].weaponLevel = 6;
    state.factions.push({ ...state.factions[0], id: 1, name: 'Joining realm', relation: 'peace', armorLevel: 0, weaponLevel: 0 });
    entityStore(state).buildings.add(building(30, 'palace', 16, 10, 1));
    const incoming = { ...unit(40, 'leader', 18.5, 12.5, 1), kills: 100 };
    entityStore(state).units.add(incoming);
    expect(diplomacyAction(state, 1, 'confederate').ok).toBe(true);
    expect(incoming).toMatchObject({ kind: 'warrior', faction: 0, armorLevel: 5, weaponLevel: 6, kills: 100 });
    expect(unitDefense(incoming)).toBe(19);
    expect(unitAttack(incoming)).toBeCloseTo(27 * 2.1 * .7);
  });
});

describe('upgraded equipment in combat', () => {
  it.each([1, 2, 3, 4, 5, 6] as EquipmentLevel[])('applies tier %i to real melee hits and javelin damage', level => {
    const state = fixture(); Object.assign(state.factions[0], { armorLevel: level, weaponLevel: level });
    applyFactionEquipment(state, 0);
    const soldier = state.units[1]; soldier.speed = 0;
    const victim = { ...unit(20, 'warrior', 16.5, 13.5, -2), attack: 0, speed: 0 };
    entityStore(state).units.add(victim);
    const multiplier = equipmentMultiplier(level);
    const expected = (17 * multiplier - 4) * .7;
    updateGame(state, .1, idle);
    expect(victim.hp).toBeCloseTo(100 - expected);
    const shot = state.projectiles?.find(projectile => projectile.attacker === state.units[0].id);
    expect(shot).toBeDefined(); expect(shot!.damage).toBeCloseTo((25 * multiplier - 4) * .7);
  });

  it.each([3, 4, 5, 6] as const)('applies tier %i armor to incoming hits and weapon upgrades to a faction tower’s attack', level => {
    const state = fixture(); state.factions[0].armorLevel = level; state.factions[0].weaponLevel = level;
    applyFactionEquipment(state, 0);
    const victim = state.units[1]; victim.attack = 0; victim.speed = 0;
    state.units[0].attack = 0;
    state.factions.push({ ...state.factions[0], id: 1, relation: 'war', armorLevel: 0, weaponLevel: 0 });
    const enemy = { ...unit(20, 'warrior', 16.5, 13.5, 1), speed: 0, attack: 30 };
    entityStore(state).units.add(enemy);
    updateGame(state, .1, idle);
    expect(victim.hp).toBeCloseTo(100 - (30 - 4 * equipmentMultiplier(level)) * .7);
    entityStore(state).buildings.add(building(3, 'woodenTower', 17, 13));
    const attacks: number[] = [];
    updateWoodenTowers(state, .1, { hostile: (a, b) => a !== b, clearShot: () => true,
      shoot: (_tower, _from, _target, attack) => attacks.push(attack) });
    expect(attacks).toEqual([WOODEN_TOWER_ATTACK * equipmentMultiplier(level)]);
  });
});
