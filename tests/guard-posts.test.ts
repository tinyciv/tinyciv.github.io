import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { GUARD_POST_CAPACITY, GUARD_POST_UPKEEP, GUARD_POST_UPKEEP_INTERVAL, militiaCityContains, updateGuardPosts, updateMilitia } from '../src/game/guard-posts';
import type { Building, GameState, Point, Unit } from '../src/game/types';

const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building => ({
  id, kind, x, y, faction, hp: 300, maxHp: 300, capacity: 0,
});
const unit = (id: number, x: number, y: number, faction = -2, kind: Unit['kind'] = 'warrior'): Unit => ({
  id, kind, x, y, faction, hp: 65, maxHp: 65, attack: 10, defense: 2, morale: 100,
  speed: 2.35, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
});
const hostile = (a: number, b: number): boolean => a >= 0 && a !== b && b !== 2;
function fixture(): GameState {
  return { world: { width: 48, height: 24, seed: 'guard-post', source: 'test', spawns: [],
    tiles: Array.from({ length: 48 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6,
      food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [], buildings: [building(1, 'palace', 8, 8), building(2, 'guardPost', 10, 10)],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 10, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'guard-post', rngState: 1 };
}
const militia = (state: GameState, post = 2): Unit[] => state.units.filter(unit => unit.kind === 'militia' && unit.guardPost === post && unit.hp > 0);
function update(state: GameState): void { updateGuardPosts(state, { hostile }); }
function actions(state: GameState, canEngage?: (unit: Unit, target: Unit) => boolean): { attacked: number[]; returned: number[] } {
  const attacked: number[] = [], returned: number[] = [];
  const orders = {
    canEngage,
    move: (_state: GameState, unit: Unit, goal: Point) => { returned.push(unit.id); unit.x = goal.x; unit.y = goal.y; },
    engage: (unit: Unit, target: Unit) => {
      attacked.push(target.id);
      // Stand off the exits, so following militia can leave through the doorway.
      unit.x = target.x - 1; unit.y = target.y + unit.id % 5 * .05;
    },
  };
  for (const unit of state.units) updateMilitia(state, unit, .1, orders);
  return { attacked, returned };
}

describe('militia guard posts', () => {
  it('does no garrison or territory work without posts and removes orphan militia', () => {
    const state = fixture(); entityStore(state).buildings.replace([]);
    update(state); expect(state.units).toEqual([]); expect(state.factions[0].gold).toBe(500);
    const orphan = { ...unit(20, 10.5, 10.5, 0, 'militia'), guardPost: 2 }; entityStore(state).units.add(orphan);
    update(state); expect(orphan.hp).toBe(0);
  });

  it('creates three sheltered defenders with stats between a regular warrior and a marauder', () => {
    const state = fixture(); update(state);
    expect(militia(state)).toHaveLength(GUARD_POST_CAPACITY);
    expect(new Set(state.units.map(unit => unit.id)).size).toBe(state.units.length);
    for (const troop of militia(state)) {
      expect(troop).toMatchObject({ inside: true, faction: 0, home: 2, hp: 85, maxHp: 85, attack: 14, defense: 3 });
      expect(troop.hp).toBeGreaterThan(65); expect(troop.hp).toBeLessThan(100);
      expect(troop.attack).toBeGreaterThan(10); expect(troop.attack).toBeLessThan(17);
      expect(troop.defense).toBeGreaterThan(2); expect(troop.defense).toBeLessThan(4);
    }
    update(state); update(state);
    expect(militia(state)).toHaveLength(3);
    expect(actions(state).attacked).toEqual([]);
    expect(state.factions[0].gold).toBe(500);
  });

  it('deploys for enemies within its city and preserves the same survivors when they return', () => {
    const state = fixture(), enemy = unit(20, 13.5, 10.5);
    entityStore(state).units.add(enemy); update(state);
    const roster = militia(state), ids = roster.map(unit => unit.id);
    expect(actions(state).attacked).toEqual(Array(3).fill(enemy.id));
    expect(roster.every(unit => !unit.inside)).toBe(true);
    roster[0].hp = 39; state.buildings[1].guardPost!.kills = 2;
    enemy.x = 45.5; state.time += 10; update(state);
    expect(actions(state).returned).toHaveLength(3);
    expect(roster.every(unit => unit.inside && unit.target === undefined)).toBe(true);
    expect(militia(state).map(unit => unit.id)).toEqual(ids);
    expect(roster[0]).toMatchObject({ hp: 39, kills: 2 });
    enemy.x = 13.5; update(state);
    expect(actions(state).attacked).toHaveLength(3);
    expect(militia(state).map(unit => unit.id)).toEqual(ids);
  });

  it('ignores peaceful, friendly, hidden, dead, wildlife, and out-of-border units', () => {
    const state = fixture();
    entityStore(state).units.add(unit(20, 12.5, 10.5, 2), unit(21, 12.5, 10.5, 0),
      { ...unit(22, 12.5, 10.5), inside: true }, { ...unit(23, 12.5, 10.5), hp: 0 },
      unit(24, 12.5, 10.5, -1, 'boar'), unit(25, 12.5, 10.5, -1, 'deer'), unit(26, 30.5, 10.5));
    update(state);
    expect(actions(state).attacked).toEqual([]);
    expect(militia(state).every(unit => unit.inside)).toBe(true);
  });

  it('responds only to threats assigned to its own city, with independent posts per city', () => {
    const state = fixture();
    entityStore(state).buildings.add({ ...building(3, 'palace', 30, 8), unhousedResidents: 5 }, building(4, 'guardPost', 32, 10));
    const enemy = unit(20, 34.5, 10.5); entityStore(state).units.add(enemy); update(state);
    expect(actions(state).attacked).toEqual(Array(3).fill(20));
    expect(militia(state, 2).every(unit => unit.inside)).toBe(true);
    expect(militia(state, 4).every(unit => !unit.inside)).toBe(true);
    expect(militiaCityContains(state, militia(state, 2)[0], enemy)).toBe(false);
    expect(militiaCityContains(state, militia(state, 4)[0], enemy)).toBe(true);
  });

  it('does not finish an attack on an enemy that has already left or died during the unit phase', () => {
    const state = fixture(), enemy = unit(20, 13.5, 10.5); entityStore(state).units.add(enemy); update(state); actions(state);
    enemy.x = 45.5; state.time += 10; // Deliberately do not rebuild the threat cache.
    expect(actions(state).attacked).toEqual([]);
    expect(militia(state).every(unit => unit.inside)).toBe(true);
    enemy.x = 13.5; update(state); actions(state); enemy.hp = 0; state.time += 10;
    expect(actions(state).attacked).toEqual([]);
    expect(militia(state).every(unit => unit.inside)).toBe(true);
  });

  it('skips an unreachable nearby intruder and checks sheltered defenders from a free exit', () => {
    const state = fixture(); entityStore(state).units.add(unit(20, 12.5, 10.5), unit(21, 13.5, 10.5)); update(state);
    const canEngage = (probe: Unit, target: Unit): boolean => {
      expect(probe.inside).toBe(false);
      expect(probe.x !== 10.5 || probe.y !== 10.5).toBe(true);
      return target.id === 21;
    };
    expect(actions(state, canEngage).attacked).toEqual(Array(3).fill(21));
    expect(actions(state, canEngage).attacked).toEqual(Array(3).fill(21));
  });

  it('stays sheltered when no intruder is reachable and retries when access opens', () => {
    const state = fixture(); entityStore(state).units.add(unit(20, 13.5, 10.5)); update(state);
    expect(actions(state, () => false).attacked).toEqual([]);
    expect(militia(state).every(unit => unit.inside)).toBe(true);
    expect(actions(state, () => true).attacked).toHaveLength(3);
  });

  it('interrupts an unfinished return as soon as another enemy enters the city', () => {
    const state = fixture(), enemy = unit(20, 13.5, 10.5); entityStore(state).units.add(enemy); update(state); actions(state);
    enemy.x = 45.5; state.time += 10; update(state);
    for (const troop of militia(state)) updateMilitia(state, troop, .1, { move: () => {}, engage: () => { throw Error('No enemy'); } });
    expect(militia(state).every(unit => !unit.inside && unit.target === undefined && unit.destination)).toBe(true);
    enemy.x = 13.5; update(state);
    expect(actions(state).attacked).toHaveLength(3);
    expect(militia(state).every(unit => unit.destination === undefined && unit.target === 20)).toBe(true);
  });

  it('charges each completed basic post fifteen gold per thirty game seconds, including peace', () => {
    const state = fixture(); state.time = 7; update(state);
    expect(state.buildings[1].guardPost?.nextUpkeepAt).toBe(37);
    state.time = 36.99; update(state); expect(state.factions[0].gold).toBe(500);
    state.time = 37; update(state); expect(state.factions[0].gold).toBe(500 - GUARD_POST_UPKEEP);
    update(state); expect(state.factions[0].gold).toBe(485);
    state.time += GUARD_POST_UPKEEP_INTERVAL * 2; update(state);
    expect(state.factions[0].gold).toBe(455);
    expect(state.buildings[1].guardPost?.nextUpkeepAt).toBe(127);
  });

  it('reports funding and post-removal changes once so displayed city yields refresh immediately', () => {
    const state = fixture();
    expect([...updateGuardPosts(state, { hostile })]).toEqual([0]);
    expect([...updateGuardPosts(state, { hostile })]).toEqual([]);
    state.factions[0].gold = 0; state.time = 30;
    expect([...updateGuardPosts(state, { hostile })]).toEqual([0]);
    expect([...updateGuardPosts(state, { hostile })]).toEqual([]);
    state.factions[0].gold = 15;
    expect([...updateGuardPosts(state, { hostile })]).toEqual([0]);
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind !== 'guardPost'));
    entityStore(state).units.replace([]); // A destroyed, empty post still changed the city's rate.
    expect([...updateGuardPosts(state, { hostile })]).toEqual([0]);
    expect([...updateGuardPosts(state, { hostile })]).toEqual([]);
  });

  it('recalls on an unpaid bill and resumes without charging accumulated unpaid debt', () => {
    const state = fixture(), enemy = unit(20, 13.5, 10.5); entityStore(state).units.add(enemy); state.factions[0].gold = 14;
    update(state); actions(state); state.time = 30; update(state);
    expect(state.buildings[1].guardPost?.funded).toBe(false);
    expect(actions(state).attacked).toHaveLength(0);
    expect(militia(state).every(unit => unit.inside)).toBe(true);
    expect(state.factions[0].gold).toBe(14);
    state.time = 300; state.factions[0].gold = 15; update(state);
    expect(state.factions[0].gold).toBe(0);
    expect(state.buildings[1].guardPost).toMatchObject({ funded: true, nextUpkeepAt: 330 });
    expect(actions(state).attacked).toHaveLength(3);
  });

  it('replaces casualties only on paid service intervals and never exceeds the purchased capacity', () => {
    const state = fixture(); update(state);
    const original = militia(state); original[0].hp = 0; original[1].hp = 0;
    state.time = 29; update(state); expect(militia(state)).toHaveLength(1);
    state.time = 30; update(state); expect(militia(state)).toHaveLength(3);
    expect(militia(state).filter(unit => original.includes(unit))).toHaveLength(1);
    militia(state)[0].hp = 0; state.factions[0].gold = 0; state.time = 60; update(state);
    expect(militia(state)).toHaveLength(2);
    state.factions[0].gold = 15; update(state); expect(militia(state)).toHaveLength(3);
    entityStore(state).units.add({ ...militia(state)[0], id: 900 }); update(state);
    expect(militia(state)).toHaveLength(3);
  });

  it('does not staff or charge unfinished posts, and stops when the post, city, or faction is lost', () => {
    const state = fixture(); state.buildings[1].construction = { startedAt: 0, duration: 30 };
    state.time = 60; update(state);
    expect(militia(state)).toHaveLength(0); expect(state.factions[0].gold).toBe(500);
    delete state.buildings[1].construction; update(state);
    expect(state.buildings[1].guardPost?.nextUpkeepAt).toBe(90);
    expect(militia(state)).toHaveLength(3);
    state.buildings[1].hp = 0; update(state); expect(militia(state)).toHaveLength(0);
    state.buildings[1].hp = 300; update(state); expect(militia(state)).toHaveLength(3);
    state.buildings[0].hp = 0; update(state); expect(militia(state)).toHaveLength(0);
    state.buildings[0].hp = 300; update(state); expect(militia(state)).toHaveLength(3);
    state.factions[0].defeated = true; update(state); expect(militia(state)).toHaveLength(0);
    expect(state.factions[0].gold).toBe(500);
  });

  it('retires the old garrison when a post changes hands', () => {
    const state = fixture(); update(state);
    const original = militia(state); state.buildings[1].faction = 1; update(state);
    expect(original.every(unit => unit.hp === 0 && unit.inside)).toBe(true);
  });

  it('works for another faction and invalidates defense if its city changes hands mid-step', () => {
    const state = fixture(); state.factions[0].id = 1;
    for (const building of state.buildings) building.faction = 1;
    const enemy = unit(20, 13.5, 10.5); entityStore(state).units.add(enemy); update(state);
    expect(actions(state).attacked).toHaveLength(3);
    expect(militia(state).every(unit => unit.faction === 1)).toBe(true);
    state.buildings[0].faction = 0;
    expect(militiaCityContains(state, militia(state)[0], enemy)).toBe(false);
    expect(actions(state).attacked).toHaveLength(0);
    expect(militia(state)).toHaveLength(0);
  });

  it('waits inside when all four exits are blocked instead of spawning into walls or water', () => {
    const state = fixture();
    for (const [x, y] of [[9, 10], [11, 10], [10, 9], [10, 11]]) entityStore(state).buildings.add(building(100 + x * 24 + y, 'house', x, y));
    entityStore(state).units.add(unit(20, 13.5, 10.5)); update(state);
    expect(actions(state).attacked).toHaveLength(0);
    expect(militia(state).every(unit => unit.inside)).toBe(true);
    entityStore(state).buildings.replace(state.buildings.filter(building => building.x !== 11 || building.y !== 10)); update(state);
    expect(actions(state).attacked).toHaveLength(3);
  });
});
