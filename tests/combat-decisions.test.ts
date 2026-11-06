import { afterEach, describe, expect, it, vi } from 'vitest';
import { scenario } from '../dev/navigation-lab/scenarios';
import { entityStore } from '../src/game/entity-store';
import { retinueFormation } from '../src/game/formation';
import * as navigation from '../src/game/pathfinding';
import * as spatial from '../src/game/spatial';
import { commandAttackAt, setRetinueStance, updateGame } from '../src/game/simulation';
import type { Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
afterEach(() => vi.restoreAllMocks());

function fixture(enemies = 0) {
  const state = scenario('Open melee'), leader = state.units[0];
  leader.attack = 0;
  const defender: Unit = { ...leader, id: 100, kind: 'warrior', x: 16.5, y: 12.5,
    hp: 10000, maxHp: 10000, attack: 17, range: 1.1, speed: 3.6, order: 'hold', lastCombat: -60 };
  const targets: Unit[] = Array.from({ length: enemies }, (_, i) => ({ ...defender, id: 200 + i,
    faction: -2, x: i ? 15.5 : 17.5, speed: 0, attack: 0, cooldown: 1000 }));
  entityStore(state).units.replace([leader, defender, ...targets]);
  state.marauderPacks = [];
  state.factions[0].nextRetinueAt = Infinity;
  return { state, defender, targets };
}

describe('staggered combat decisions with continuous execution', () => {
  it('bounds empty searches to three per second instead of every simulation step', () => {
    const { state, defender } = fixture();
    const searches = vi.spyOn(spatial, 'nearbyUnits');
    for (let i = 0; i < 120; i++) updateGame(state, 1 / 60, idle);
    const count = searches.mock.calls.filter(([, observer, radius]) => observer === defender && radius === 1.5).length;
    expect(count).toBeGreaterThanOrEqual(6);
    expect(count).toBeLessThanOrEqual(8);
  });

  it('caps active target scans at three Hz while attacks retain their 0.95 second cooldown', () => {
    const { state, defender, targets: [enemy] } = fixture(1);
    const searches = vi.spyOn(spatial, 'nearbyUnits'), hits: number[] = [];
    let hp = enemy.hp;
    for (let i = 0; i < 150; i++) {
      updateGame(state, 1 / 60, idle);
      if (enemy.hp < hp) hits.push(state.time);
      hp = enemy.hp;
    }
    const count = searches.mock.calls.filter(([, observer, radius]) => observer === defender && radius === 1.5).length;
    expect(count).toBeGreaterThanOrEqual(6);
    expect(count).toBeLessThanOrEqual(8);
    expect(hits).toHaveLength(3);
    for (let i = 1; i < hits.length; i++) expect(hits[i] - hits[i - 1]).toBeCloseTo(.95, 2);
  });

  it('drops a killed target immediately and replaces it on a capped sensing step', () => {
    const { state, defender, targets } = fixture(2);
    updateGame(state, .016, idle);
    const victim = targets.find(target => target.id === defender.target)!;
    const survivor = targets.find(target => target !== victim)!;
    victim.hp = 0;
    updateGame(state, .001, idle);
    expect(defender.target).not.toBe(victim.id);
    updateGame(state, .7, idle);
    expect(defender.target).toBe(survivor.id);
  });

  it('drops a target that leaves the held unit’s range immediately', () => {
    const { state, defender, targets: [enemy] } = fixture(1);
    updateGame(state, .016, idle);
    expect(defender.target).toBe(enemy.id);
    enemy.x += 4;
    updateGame(state, .001, idle);
    expect(defender.target).toBeUndefined();
  });

  it('executes an explicit attack immediately after an empty search', () => {
    const { state, defender, targets: [enemy] } = fixture(1);
    enemy.x = 20.5;
    updateGame(state, .016, idle);
    expect(defender.target).toBeUndefined();
    expect(commandAttackAt(state, enemy.x, enemy.y)).toBe(true);
    updateGame(state, .001, idle);
    expect(defender.target).toBe(enemy.id);
    expect(defender.moving).toBe(true);
  });

  it('continues an approach on every fast step between target decisions', () => {
    const { state, defender, targets: [enemy] } = fixture(1);
    enemy.x = 21.5;
    setRetinueStance(state, 'aggressive');
    for (let i = 0; i < 12; i++) {
      const x = defender.x;
      updateGame(state, 1 / 60, idle);
      expect(defender.target).toBe(enemy.id);
      expect(defender.x).toBeGreaterThan(x);
    }
  });

  it('reuses a stationary rally flood fill, but invalidates it for changed ground and membership', () => {
    const { state, defender } = fixture();
    defender.order = 'follow';
    const leader = state.units[0], probes = vi.spyOn(navigation, 'canWalk');
    retinueFormation(state, leader);
    const oneLayout = probes.mock.calls.length;
    expect(oneLayout).toBeGreaterThan(10);
    for (let i = 1; i <= 60; i++) { state.time = i / 60; retinueFormation(state, leader); }
    expect(probes.mock.calls.length).toBeLessThanOrEqual(oneLayout * 5);
    let count = probes.mock.calls.length;
    state.world.revision!++;
    retinueFormation(state, leader);
    expect(probes.mock.calls.length).toBeGreaterThan(count);
    count = probes.mock.calls.length;
    entityStore(state).units.add({ ...defender, id: 101, y: defender.y + 1 });
    expect(retinueFormation(state, leader).goals.has(101)).toBe(true);
    expect(probes.mock.calls.length).toBeGreaterThan(count);
  });

  it('refreshes formation commands and replacement worlds even within the same fast step', () => {
    const { state, defender } = fixture();
    defender.order = 'follow';
    const leader = state.units[0];
    expect(retinueFormation(state, leader).goals.has(defender.id)).toBe(true);
    setRetinueStance(state, 'hold');
    expect(retinueFormation(state, leader).goals.size).toBe(0);
    setRetinueStance(state, 'aggressive');
    const oldGoal = retinueFormation(state, leader).goals.get(defender.id)!;
    state.world = { ...state.world };
    leader.x = 23.5;
    const newGoal = retinueFormation(state, leader).goals.get(defender.id)!;
    expect(newGoal.x).toBeGreaterThan(oldGoal.x + 10);
  });
});
