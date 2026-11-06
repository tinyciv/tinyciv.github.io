import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { guardPostCapacity, guardPostUpkeep, guardPostUpgradeStatus, recordGuardCasualty, recordGuardKill, updateGuardPosts, updateMilitia, upgradeGuardPost } from '../src/game/guard-posts';
import { veterancy } from '../src/game/veterancy';
import type { Building, GameState, Unit } from '../src/game/types';
const building = (id: number, kind: Building['kind'], x: number, y: number, extra: Partial<Building> = {}): Building => ({
  id, kind, x, y, faction: 0, hp: 300, maxHp: 300, capacity: 0, ...extra });
const person = (id: number, x: number, y: number, kind: Unit['kind'] = 'warrior', faction = -2): Unit => ({
  id, kind, x, y, faction, hp: 65, maxHp: 65, attack: 10, defense: 2, morale: 100, speed: 2.35, range: 1.1,
  order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
function fixture(): GameState {
  return { world: { width: 48, height: 24, seed: 'guard-upgrades', source: 'test', spawns: [],
    tiles: Array.from({ length: 48 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6,
      food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [person(10, 10.5, 12.5, 'leader', 0)], buildings: [building(1, 'palace', 8, 8), building(2, 'guardPost', 10, 10)],
    factions: [{ id: 0, name: 'Roma', color: '#f34f59', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 10, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'guard-upgrades', rngState: 1 };
}
const hostile = (a: number, b: number) => a >= 0 && a !== b;
const update = (state: GameState) => updateGuardPosts(state, { hostile });
const guards = (state: GameState) => state.units.filter(unit => unit.kind === 'militia' && unit.hp > 0);
const engage = (state: GameState) => {
  const attacked: number[] = [], returned: number[] = [];
  for (const guard of guards(state)) updateMilitia(state, guard, .1, {
    move: (_state, unit, point) => { returned.push(unit.id); unit.x = point.x; unit.y = point.y; },
    engage: (unit, target) => { attacked.push(target.id); unit.x = target.x - .5; unit.y = target.y; },
  });
  return { attacked, returned };
};

describe('guard post upgrades and city manpower', () => {
  it.each([
    { level: 0 as const, capacity: 3, cost: 15 },
    { level: 1 as const, capacity: 5, cost: 20 },
    { level: 2 as const, capacity: 8, cost: 30 },
  ])('charges $cost once per service period for the $capacity-guard tier and suspends unaffordable service', ({ level, capacity, cost }) => {
    const state = fixture(), post = state.buildings[1];
    post.guardPost = { level, funded: true, nextUpkeepAt: 30, needsRecruits: true };
    update(state);
    expect(guardPostUpkeep(post)).toBe(cost);
    expect(guards(state)).toHaveLength(capacity);
    expect(state.factions[0].gold).toBe(500);
    state.time = 30; update(state); update(state);
    expect(state.factions[0].gold).toBe(500 - cost);
    expect(post.guardPost.nextUpkeepAt).toBe(60);
    state.factions[0].gold = cost - 1; state.time = 60; update(state);
    expect(post.guardPost.funded).toBe(false);
    expect(state.factions[0].gold).toBe(cost - 1);
    state.factions[0].gold = cost; state.time = 300; update(state);
    expect(state.factions[0].gold).toBe(0);
    expect(post.guardPost).toMatchObject({ funded: true, nextUpkeepAt: 330 });
  });

  it('bills an upgraded post at its new tier on the next service deadline', () => {
    const state = fixture(), post = state.buildings[1]; update(state);
    expect(upgradeGuardPost(state, post).ok).toBe(true);
    expect([...updateGuardPosts(state, { hostile })]).toEqual([0]);
    expect([...updateGuardPosts(state, { hostile })]).toEqual([]);
    state.time = 30; update(state);
    expect(state.factions[0].gold).toBe(500 - 100 - 20);
    state.time = 40; expect(upgradeGuardPost(state, post).ok).toBe(true);
    state.time = 60; update(state);
    expect(state.factions[0].gold).toBe(500 - 100 - 20 - 125 - 30);
  });

  it('buys three, five, then eight slots with atomic 100/125-gold upgrades and disabled invalid purchases', () => {
    const state = fixture(), post = state.buildings[1]; update(state);
    expect(guards(state)).toHaveLength(3); expect(guardPostCapacity(post)).toBe(3);
    state.factions[0].gold = 99;
    expect(guardPostUpgradeStatus(state, post)).toMatchObject({ available: false, cost: 100, nextCapacity: 5 });
    expect(upgradeGuardPost(state, post).ok).toBe(false); expect(state.factions[0].gold).toBe(99);
    state.factions[0].gold = 225;
    expect(upgradeGuardPost(state, post).ok).toBe(true); update(state);
    expect(guards(state)).toHaveLength(5); expect(state.factions[0].gold).toBe(125);
    expect(upgradeGuardPost(state, post).ok).toBe(true); update(state);
    expect(guards(state)).toHaveLength(8); expect(state.factions[0].gold).toBe(0);
    expect(guardPostUpgradeStatus(state, post)).toMatchObject({ available: false, nextCapacity: null, cost: null });
    expect(upgradeGuardPost(state, post).ok).toBe(false);
  });

  it('never recruits more guards than local residents and does not borrow another city’s people', () => {
    const state = fixture(); state.factions[0].population = 4;
    entityStore(state).buildings.add(building(3, 'guardPost', 10, 7), building(4, 'palace', 35, 8), building(5, 'guardPost', 37, 10));
    update(state);
    expect(guards(state)).toHaveLength(4);
    expect(guards(state).filter(unit => unit.guardPost === 5)).toHaveLength(0);
    state.buildings[3].unhousedResidents = 2; update(state);
    expect(guards(state).filter(unit => unit.guardPost === 5)).toHaveLength(2);
    expect(guards(state)).toHaveLength(4);
    expect(state.factions[0].population).toBe(4);
  });

  it('keeps experience on the post through deaths, recruits, unpaid service and territory loss', () => {
    const state = fixture(), post = state.buildings[1]; update(state);
    const first = guards(state)[0];
    for (let i = 0; i < 10; i++) expect(recordGuardKill(state, first)).toBe(true);
    expect(post.guardPost?.kills).toBe(10);
    expect(guards(state).every(unit => unit.kills === 10 && veterancy(unit) === 1)).toBe(true);
    first.hp = 0; recordGuardCasualty(state, first);
    expect(state.factions[0].population).toBe(9);
    state.time = 30; update(state); expect(guards(state)).toHaveLength(3);
    expect(guards(state).every(unit => unit.kills === 10)).toBe(true);
    state.factions[0].gold = 0; state.time = 60; update(state);
    expect(post.guardPost).toMatchObject({ funded: false, kills: 10 });
    state.buildings[0].x = 35; update(state); expect(post.guardPost?.kills).toBe(10);
    post.hp = 0; update(state); expect(post.guardPost).toBeUndefined();
  });

  it('removes one resident from the dead guard’s own city exactly once and ignores retirement', () => {
    const state = fixture(); entityStore(state).buildings.add(building(3, 'house', 11, 8, { capacity: 4, residents: 4 }),
      building(4, 'palace', 35, 8, { unhousedResidents: 6 }), building(5, 'guardPost', 37, 10));
    update(state);
    const guard = guards(state).find(unit => unit.guardPost === 5)!;
    guard.hp = 0;
    expect(recordGuardCasualty(state, guard)).toBe(true); expect(recordGuardCasualty(state, guard)).toBe(false);
    expect(state.factions[0].population).toBe(9); expect(state.buildings[2].residents).toBe(4);
    expect(state.buildings[3].unhousedResidents).toBe(5);
    const local = guards(state).find(unit => unit.guardPost === 2)!;
    state.buildings[1].hp = 0; update(state);
    expect(local.guardRetired).toBe(true); expect(recordGuardCasualty(state, local)).toBe(false);
    expect(state.factions[0].population).toBe(9);
  });

  it('holds outside for ten seconds after the last sighting, then returns', () => {
    const state = fixture(), enemy = person(20, 13.5, 10.5); entityStore(state).units.add(enemy); update(state); engage(state);
    expect(guards(state).every(unit => !unit.inside)).toBe(true);
    enemy.x = 40; state.time = 9.99; update(state);
    expect(engage(state)).toEqual({ attacked: [], returned: [] });
    expect(guards(state).every(unit => !unit.inside)).toBe(true);
    state.time = 10; update(state); expect(engage(state).returned).toHaveLength(3);
    expect(guards(state).every(unit => unit.inside)).toBe(true);
  });

  it('rescues a nearby peasant and continues the chase only within the twenty-tile post range', () => {
    const state = fixture(), worker = person(20, 18.5, 10.5, 'worker', 0), enemy = person(21, 20.5, 10.5);
    entityStore(state).units.add(worker, enemy); update(state);
    expect(engage(state).attacked).toEqual([21, 21, 21]);
    enemy.x = 25.5; state.time = 1; update(state);
    expect(engage(state).attacked).toEqual([21, 21, 21]);
    enemy.x = 31.5; state.time = 2; update(state);
    expect(engage(state).attacked).toEqual([]);
    state.time = 11; update(state); expect(engage(state).returned).toHaveLength(3);
  });

  it('ignores a distant civilian and an approach hidden by dense forest', () => {
    const state = fixture(), worker = person(20, 18.5, 10.5, 'worker', 0), enemy = person(21, 21.5, 10.5);
    for (let x = 19; x <= 21; x++) state.world.tiles[10 * state.world.width + x].overlay = 'forest';
    entityStore(state).units.add(worker, enemy); update(state); expect(engage(state).attacked).toEqual([]);
    worker.x = 30.5; enemy.x = 32.5; update(state); expect(engage(state).attacked).toEqual([]);
  });
});
