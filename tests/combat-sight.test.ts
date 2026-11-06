import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { entityVisible } from '../src/game/fog';
import { HIDDEN_MARAUDER_UPDATE_DIVISOR } from '../src/game/marauder-schedule';
import { updateGame } from '../src/game/simulation';
import { type Building, type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const unit = (id: number, kind: Unit['kind'], x: number, y: number, faction = 0): Unit => ({
  id, kind, faction, x, y, hp: 100, morale: 100, attack: 0, defense: 0, speed: 0,
  range: kind === 'leader' ? 4 : 1.1, order: 'follow', cooldown: 0, lastCombat: -60,
  moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({
  id, kind, faction, x, y, hp: 650, maxHp: 650, capacity: 0,
});
function fixture(): GameState {
  return { world: { width: 48, height: 36, seed: 'combat-sight', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 48 * 36 }, () => ({ terrain: 'grassland', overlay: 'forest', elevation: .4,
      moisture: .6, food: 2, production: 3, gold: 0, variation: .5 })) },
    units: [unit(10, 'leader', 3.5, 31.5)], buildings: [building(1, 'palace', 3, 3)],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 10000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], projectiles: [], selected: null,
    selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'combat-sight',
    rngState: 1, fields: [], marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: 10000, waves: 0, pressureVersion: 2 }, enemyPressureVersion: 1 };
}
function clearTrees(state: GameState): void {
  for (const tile of state.world.tiles) tile.overlay = 'none';
  state.world.revision!++;
}
function addBand(state: GameState, member: Unit): void {
  member.marauderPack = 900; member.order = 'wander';
  state.marauderPacks!.push({ id: 900, name: 'Test band', color: '#f00', targetFaction: 0,
    home: { x: member.x, y: member.y }, waypoint: { x: member.x, y: member.y }, nextWanderAt: 10000 });
}
/** Hidden observers sense once per five real steps. Keep the same elapsed
 * combat time while giving every staggered observer its scheduled turn. */
function hiddenSensingCycle(state: GameState, seconds = .1): void {
  for (let step = 0; step < HIDDEN_MARAUDER_UPDATE_DIVISOR; step++)
    updateGame(state, seconds / HIDDEN_MARAUDER_UPDATE_DIVISOR, idle);
}
/** Fog and target sensing have independent bounded clocks. Stop at acquisition
 * so a launched projectile is inspected before its continuous flight finishes. */
function nextSensedChange(state: GameState, changed: () => boolean): void {
  for (let step = 0; step < 50 && !changed(); step++) updateGame(state, .02, idle);
}

describe('cover-limited combat sight', () => {
  it.each([false, true])('gives enemy unit observers extra downhill sight but no same-level bonus (target raised=%s)', targetRaised => {
    const state = fixture(), target = state.units[0], attacker = unit(20, 'leader', 16.5, 14.5, -2);
    Object.assign(target, { x: 20, y: 14.5 });
    Object.assign(attacker, { attack: 25 });
    entityStore(state).units.add(attacker);
    for (let y = 13; y <= 15; y++) for (let x = 15; x <= 17; x++) state.world.tiles[y * 48 + x].ridge = 1;
    if (targetRaised) for (let y = 13; y <= 15; y++) for (let x = 19; x <= 21; x++) state.world.tiles[y * 48 + x].ridge = 2;
    state.world.revision!++;
    hiddenSensingCycle(state);
    expect(attacker.target).toBe(targetRaised ? undefined : target.id);
    expect(state.projectiles?.some(projectile => projectile.attacker === attacker.id)).toBe(!targetRaised);
  });

  it('keeps an idle player leader from firing into hidden woodland, then accepts an allied scout report', () => {
    const state = fixture(), leader = state.units[0], target = unit(20, 'warrior', 20.5, 14.5, -2);
    Object.assign(leader, { x: 16.5, y: 14.5, attack: 25 }); entityStore(state).units.add(target);
    expect(entityVisible(state, target)).toBe(false);
    updateGame(state, .1, idle);
    expect(state.projectiles).toHaveLength(0);
    entityStore(state).units.add(unit(11, 'worker', 20.5, 15.5));
    nextSensedChange(state, () => !!state.projectiles?.length);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles![0]).toMatchObject({ attacker: leader.id, target: target.id });
  });

  it('keeps an ordinary following escort from pursuing an unseen enemy', () => {
    const state = fixture(), leader = state.units[0], escort = unit(11, 'warrior', 17.5, 14.5), target = unit(20, 'warrior', 21.5, 14.5, -2);
    Object.assign(leader, { x: 16.5, y: 14.5 }); entityStore(state).units.add(escort, target);
    updateGame(state, .1, idle);
    expect(escort.target).toBeUndefined();
    clearTrees(state);
    nextSensedChange(state, () => escort.target === target.id);
    expect(escort.target).toBe(target.id);
  });

  it('uses scout movement on the next bounded visibility and warrior sample', () => {
    const state = fixture(), leader = state.units[0], escort = unit(11, 'warrior', 18.5, 16.5), target = unit(20, 'warrior', 21.5, 14.5, -2);
    Object.assign(leader, { x: 18.95, y: 14.5, speed: 3.6 });
    escort.retinueStance = 'aggressive'; entityStore(state).units.add(escort, target);
    expect(entityVisible(state, target)).toBe(false);
    updateGame(state, .1, { ...idle, right: true });
    expect(leader.x).toBeGreaterThan(19);
    nextSensedChange(state, () => escort.target === target.id);
    expect(escort.target).toBe(target.id);
  });

  it('drops sight from a killed scout on the next visibility sample', () => {
    const state = fixture(), escort = unit(11, 'warrior', 18.5, 14.5), scout = unit(12, 'worker', 21.5, 15.5), killer = unit(20, 'warrior', 20.5, 15.5, -2), target = unit(21, 'warrior', 21.5, 14.5, -2);
    Object.assign(killer, { attack: 1000, order: 'hold' });
    escort.retinueStance = 'aggressive';
    entityStore(state).units.replace([killer, state.units[0], escort, scout, target]);
    expect(entityVisible(state, target)).toBe(true);
    updateGame(state, .1, idle);
    expect(scout.hp).toBeLessThanOrEqual(0);
    updateGame(state, .4, idle);
    expect(escort.target).toBeUndefined();
    expect(entityVisible(state, target)).toBe(false);
  });

  it.each(['leader', 'warrior'] as const)('limits enemy %s acquisition by its own sight', kind => {
    const state = fixture(), target = state.units[0], attacker = unit(20, kind, 16.5, 14.5, -2);
    Object.assign(target, { x: 20.5, y: 14.5 }); entityStore(state).units.add(attacker);
    updateGame(state, .1, idle);
    expect(attacker.target).toBeUndefined();
    clearTrees(state);
    nextSensedChange(state, () => attacker.target === target.id);
    expect(attacker.target).toBe(target.id);
  });

  it.each(['leader', 'marauder'] as const)('drops an enemy %s stored mobile target when it vanishes into woodland', kind => {
    const state = fixture(), target = state.units[0], attacker = unit(20, kind === 'leader' ? 'leader' : 'warrior', 16.5, 14.5, -2);
    Object.assign(target, { x: 18, y: 14.5 }); entityStore(state).units.add(attacker);
    if (kind === 'marauder') addBand(state, attacker);
    updateGame(state, .1, idle);
    expect(attacker.target).toBe(target.id);
    target.x = 20.5;
    hiddenSensingCycle(state);
    expect(attacker.target).not.toBe(target.id);
    // An active band resumes its known settlement objective when it loses
    // the mobile target; it should not resume tracking the hidden unit.
    expect(attacker.target).toBe(kind === 'marauder' ? state.buildings[0].id : undefined);
  });

  it.each([0, -2])('prevents faction %s towers from firing farther into forest than they can see', faction => {
    const state = fixture(), tower = building(2, 'woodenTower', 16, 14, faction), target = unit(20, 'warrior', 20.5, 14.5, faction === 0 ? -2 : 0);
    entityStore(state).buildings.add(tower); entityStore(state).units.add(target);
    updateGame(state, .1, idle);
    expect(state.projectiles).toHaveLength(0);
    clearTrees(state);
    nextSensedChange(state, () => !!state.projectiles?.length);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles![0]).toMatchObject({ attacker: tower.id, target: target.id });
  });

  it('lets a javelin already in flight land after its target becomes hidden', () => {
    const state = fixture(), leader = state.units[0], target = unit(20, 'warrior', 20.5, 14.5, -2);
    clearTrees(state); Object.assign(leader, { x: 16.5, y: 14.5, attack: 25 }); entityStore(state).units.add(target);
    updateGame(state, .1, idle);
    expect(state.projectiles).toHaveLength(1);
    for (const tile of state.world.tiles) tile.overlay = 'forest'; state.world.revision!++;
    expect(entityVisible(state, target)).toBe(false);
    updateGame(state, .5, idle);
    expect(target.hp).toBe(82.5);
    expect(state.projectiles).toHaveLength(0);
  });

  it('keeps a distant raid building objective while woodland conceals its occupants', () => {
    const state = fixture(), attacker = unit(20, 'warrior', 24.5, 14.5, -2), house = building(2, 'house', 35, 14);
    attacker.speed = 2.35; entityStore(state).units.add(attacker); entityStore(state).buildings.add(house); addBand(state, attacker);
    Object.assign(state.marauderPacks![0], { raid: true, targetBuilding: house.id });
    hiddenSensingCycle(state);
    expect(attacker.target).toBe(house.id);
    expect(attacker.x).toBeGreaterThan(24.5);
  });

  it('does not trigger a marauder leader retreat from unseen nearby enemies', () => {
    const state = fixture(), target = state.units[0], commander = unit(20, 'warrior', 16.5, 14.5, -2), escort = unit(21, 'warrior', 16.5, 16.5, -2);
    Object.assign(target, { x: 20, y: 14.5, attack: 20 });
    Object.assign(commander, { marauderLeader: true, hp: 40, lastDamagedAt: -100 });
    entityStore(state).units.add(commander, escort); addBand(state, commander); escort.marauderPack = commander.marauderPack;
    Object.assign(state.marauderPacks![0], { leaderId: commander.id, startingTroops: 1 });
    updateGame(state, .1, idle);
    expect(commander.marauderRetreating).not.toBe(true);
    clearTrees(state);
    nextSensedChange(state, () => commander.marauderRetreating === true);
    expect(commander.marauderRetreating).toBe(true);
  });
});
