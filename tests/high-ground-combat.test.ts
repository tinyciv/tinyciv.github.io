import { describe, expect, it } from 'vitest';
import { downhillRangeBonus, maximumUnitRange, unitAttackRange } from '../src/game/combat-range';
import { attackSpots } from '../src/game/engagement';
import { entityStore } from '../src/game/entity-store';
import { toggleInfantryFormation } from '../src/game/infantry-drill';
import { updateRaiderMotivation } from '../src/game/raider-motivations';
import { updateGame } from '../src/game/simulation';
import { type Building, type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const soldier = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
  id, kind, x, y, faction, hp: 100, morale: 100, attack: 20, defense: 0, speed: 0,
  range: kind === 'leader' || kind === 'archer' ? 4 : 1.1, order: 'hold', cooldown: 0, lastCombat: -60,
  moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], x: number, y: number): Building => ({
  id, kind, x, y, faction: 0, hp: 650, maxHp: 650, capacity: 0,
});
function fixture(): GameState {
  return { world: { width: 48, height: 32, seed: 'downhill-combat', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [soldier(1, 'leader', 3.5, 22.5)], buildings: [{ ...building(2, 'palace', 3, 24), populationGrowth: -10000,
      governorPermissions: { farms: false, housing: false } }],
    factions: [{ id: 0, name: 'Test', color: '#f44', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 500, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'downhill-combat', rngState: 1, fields: [],
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 } };
}
function plateau(state: GameState, x: number, y: number, tier = 1): void {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
    Object.assign(state.world.tiles[(y + dy) * state.world.width + x + dx], { ridge: 1, ridgeTier: tier });
  state.world.revision!++;
}

describe('downhill firing range', () => {
  it('adds exactly one tile for any downward tier change, and none for noise, flat or uphill shots', () => {
    const state = fixture(), archer = soldier(10, 'archer', 12.5, 12.5), target = { x: 17.5, y: 12.5 };
    state.world.tiles[12 * 48 + 12].elevation = .99;
    expect(unitAttackRange(state.world, archer, target)).toBe(4);
    plateau(state, 12, 12, 3);
    expect(downhillRangeBonus(state.world, archer, target)).toBe(1);
    expect(unitAttackRange(state.world, archer, target)).toBe(5);
    plateau(state, 18, 12, 3);
    expect(unitAttackRange(state.world, archer, target)).toBe(4);
    plateau(state, 18, 12, 4);
    expect(unitAttackRange(state.world, archer, target)).toBe(4);
  });

  it.each(['warrior', 'spearman', 'horseman', 'militia'] as const)('does not extend %s melee reach', kind => {
    const state = fixture(), unit = soldier(10, kind, 12.5, 12.5); plateau(state, 12, 12);
    expect(unitAttackRange(state.world, unit, { x: 17.5, y: 12.5 })).toBe(1.1);
    expect(maximumUnitRange(unit)).toBe(1.1);
  });

  it.each(['leader', 'archer'] as const)('automatically acquires and hits from a stationary %s at the exact extended boundary', kind => {
    const state = fixture(), unit = soldier(10, kind, 12.5, 12.5), victim = soldier(20, 'warrior', 17.5, 12.5, -2);
    if (kind === 'leader') entityStore(state).units.retain(() => false);
    victim.attack = 0; entityStore(state).units.add(unit, victim); plateau(state, 12, 12);
    updateGame(state, .05, idle);
    expect(state.projectiles?.find(shot => shot.attacker === unit.id)?.target).toBe(victim.id);
    expect(unit.x).toBe(12.5); expect(unit.y).toBe(12.5);
    updateGame(state, .5, idle); expect(victim.hp).toBeLessThan(100);
  });

  it.each(['flat', 'uphill', 'too far', 'blocked'] as const)('does not fire an extended shot when %s', condition => {
    const state = fixture(), archer = soldier(10, 'archer', 12.5, 12.5), victim = soldier(20, 'warrior', 17.5, 12.5, -2);
    victim.attack = 0; entityStore(state).units.add(archer, victim);
    if (condition !== 'flat') plateau(state, 12, 12);
    if (condition === 'uphill') plateau(state, 18, 12, 2);
    if (condition === 'too far') victim.x += .01;
    if (condition === 'blocked') entityStore(state).buildings.add(building(30, 'wall', 15, 12));
    updateGame(state, .05, idle);
    expect(state.projectiles?.filter(shot => shot.attacker === archer.id) ?? []).toHaveLength(0);
  });

  it.each(['woodenTower', 'palace', 'ballista'] as const)('allows a %s to fire and hit in its extra downhill tile', kind => {
    const state = fixture(), tower = building(10, kind, 12, 12);
    if (kind === 'palace') tower.palaceLevel = 2;
    entityStore(state).buildings.add(tower); plateau(state, 12, 12);
    const origin = kind === 'palace' ? 13 : 12.5, range = kind === 'ballista' ? 18 : 6;
    const victim = soldier(20, 'warrior', origin + range + .8, origin, -2); victim.attack = 0;
    entityStore(state).units.add(victim);
    updateGame(state, .05, idle);
    expect(state.projectiles?.find(shot => shot.attacker === tower.id)?.target).toBe(victim.id);
    for (let i = 0; i < 5; i++) updateGame(state, .4, idle);
    expect(victim.hp).toBeLessThan(100);
  });

  it('offers elevated firing positions without requiring archers to descend to base range', () => {
    const state = fixture(), archer = soldier(10, 'archer', 12.5, 12.5), victim = soldier(20, 'warrior', 17.5, 12.5, -2);
    entityStore(state).units.add(archer, victim); plateau(state, 12, 12);
    expect(attackSpots(state, archer, victim, () => true)).toContainEqual({ x: 12.5, y: 12.5 });
    // The same cell no longer qualifies after losing the height advantage.
    plateau(state, 18, 12);
    expect(attackSpots(state, archer, victim, () => true)).not.toContainEqual({ x: 12.5, y: 12.5 });
  });

  it.each(['woodenTower', 'palace', 'ballista'] as const)('does not extend a %s shot against equal-height targets', kind => {
    const state = fixture(), tower = building(10, kind, 12, 12);
    if (kind === 'palace') tower.palaceLevel = 2;
    entityStore(state).buildings.add(tower); plateau(state, 12, 12);
    const origin = kind === 'palace' ? 13 : 12.5, range = kind === 'ballista' ? 18 : 6;
    const victim = soldier(20, 'warrior', origin + range + .8, origin, -2); victim.attack = 0;
    entityStore(state).units.add(victim); plateau(state, Math.floor(victim.x), Math.floor(victim.y));
    updateGame(state, .05, idle);
    expect(state.projectiles?.filter(shot => shot.attacker === tower.id) ?? []).toHaveLength(0);
  });

  it('keeps formation archers in their rear slots while firing downhill', () => {
    const state = fixture(), leader = state.units[0]; Object.assign(leader, { x: 12.5, y: 12.5, attack: 0 });
    state.factions[0].research = { focus: 'infantryDrill', levels: { infantryDrill: 1 }, progress: {} };
    const archer = soldier(10, 'archer', 11.5, 12.5);
    entityStore(state).units.add(archer, ...Array.from({ length: 7 }, (_, i) => ({ ...soldier(30 + i, 'warrior', 12.5, 12.5), attack: 0 })));
    plateau(state, 12, 12); expect(toggleInfantryFormation(state).ok).toBe(true);
    for (const slot of leader.infantryFormation!.slots) {
      const member = state.units.find(unit => unit.id === slot.id)!;
      member.x = leader.x + slot.x; member.y = leader.y + slot.y;
    }
    const before = { x: archer.x, y: archer.y }, victim = soldier(20, 'warrior', archer.x + 4.9, archer.y, -2);
    victim.attack = 0; entityStore(state).units.add(victim);
    updateGame(state, .05, idle);
    expect(state.projectiles?.find(shot => shot.attacker === archer.id)?.target).toBe(victim.id);
    expect(archer.x).toBeCloseTo(before.x); expect(archer.y).toBeCloseTo(before.y);
    expect(archer.infantryDrillLeader).toBe(leader.id);
  });

  it('lets an elevated defensive archer fire from the outer edge of its anchor leash', () => {
    const state = fixture(), archer = soldier(10, 'archer', 12.5, 12.5), victim = soldier(20, 'warrior', 17.4, 12.5, -2);
    Object.assign(archer, { order: 'follow', retinueStance: 'defensive', defensiveAnchor: { x: 9.5, y: 12.5 } });
    victim.attack = 0; entityStore(state).units.add(archer, victim); plateau(state, 12, 12);
    updateGame(state, .05, idle);
    expect(state.projectiles?.find(shot => shot.attacker === archer.id)?.target).toBe(victim.id);
  });

  it('uses the downhill reach while marauders muster, without expanding flat-ground acquisition', () => {
    const state = fixture(), archer = soldier(10, 'archer', 12.5, 12.5, -2), victim = soldier(20, 'warrior', 17.5, 12.5);
    archer.marauderPack = 50; entityStore(state).units.add(archer, victim);
    state.marauderPacks = [{ id: 50, name: 'Test', color: '#111', targetFaction: 0, raid: true, motivation: 'siege',
      phase: 'approach', home: { x: 4.5, y: 4.5 }, waypoint: { x: 12.5, y: 12.5 }, rally: { x: 12.5, y: 12.5 }, nextWanderAt: Infinity }];
    const shots: number[] = [], orders = { move: () => {}, visible: () => true,
      attack: (_attacker: Unit, target: Unit | Building) => { shots.push(target.id); } };
    updateRaiderMotivation(state, archer, .05, orders); expect(shots).toEqual([]);
    plateau(state, 12, 12);
    updateRaiderMotivation(state, archer, .05, orders); expect(shots).toEqual([victim.id]);
  });
});
