import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEntities } from '../src/game/entity-store';
import { CHECK_INTERVAL, recurringWorkElapsed, recurringWorkInterval, runRecurringWork, withDeferredMaintenance, withImmediateMaintenance } from '../src/game/work-cadence';
import { updateGame } from '../src/game/simulation';
import * as farms from '../src/game/farms';
import * as strategies from '../src/game/faction-strategy';
import * as levies from '../src/game/mass-levy';
import * as construction from '../src/game/structures';
import * as sailing from '../src/game/sailing';
import type { GameState } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'cadence', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 3, production: 0, gold: 1, variation: .5 })) },
    units: [{ id: 10, kind: 'leader', faction: 0, x: 3.5, y: 3.5, hp: 100, maxHp: 100,
      attack: 0, defense: 0, morale: 100, speed: 3.6, range: 4, order: 'hold', cooldown: 0,
      lastCombat: -60, lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0 }],
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 2, y: 6, hp: 650, maxHp: 650, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'cadence', rngState: 1,
    fields: [], marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: 1000, waves: 0, pressureVersion: 2 },
  };
}

afterEach(() => vi.restoreAllMocks());
describe('maximum recurring work cadence', () => {
  it('defers transaction housekeeping without consuming its deadline or elapsed credit', () => {
    const state = fixture();
    expect(recurringWorkElapsed(state, 'staff', .1, 0)).toBe(.1);
    state.time = .1;
    expect(recurringWorkElapsed(state, 'staff', .1, 0)).toBeUndefined();
    expect(() => withDeferredMaintenance(state, () => {
      withDeferredMaintenance(state, () => expect(recurringWorkElapsed(state, 'new', 0)).toBeUndefined());
      withImmediateMaintenance(state, () => expect(recurringWorkElapsed(state, 'staff', 0)).toBeUndefined());
      throw new Error('interrupted');
    })).toThrow('interrupted');
    expect(recurringWorkElapsed(state, 'new', 0)).toBe(0);
    withImmediateMaintenance(state, () => expect(recurringWorkElapsed(state, 'staff', 0)).toBe(.1));
  });

  it('publishes explicit maintenance once while paused without losing accrued elapsed time', () => {
    const state = fixture();
    expect(recurringWorkElapsed(state, 'staff', .1)).toBe(.1);
    state.time = .1;
    expect(recurringWorkElapsed(state, 'staff', .1)).toBeUndefined();
    state.paused = true;
    withImmediateMaintenance(state, () => {
      expect(recurringWorkElapsed(state, 'staff', 0, 0)).toBe(.1);
      withImmediateMaintenance(state, () => expect(recurringWorkElapsed(state, 'staff', 0, 0)).toBeUndefined());
      expect(recurringWorkElapsed(state, 'rates', 0)).toBe(0);
    });
    expect(state.time).toBe(.1);
    expect(recurringWorkElapsed(state, 'staff', 0)).toBeUndefined();
    state.time += CHECK_INTERVAL;
    expect(recurringWorkElapsed(state, 'staff', CHECK_INTERVAL, 0)).toBe(CHECK_INTERVAL);
  });

  it('closes an explicit maintenance scope after an interrupted command', () => {
    const state = fixture(); recurringWorkElapsed(state, 'staff', 0);
    expect(() => withImmediateMaintenance(state, () => {
      expect(recurringWorkElapsed(state, 'staff', 0)).toBe(0);
      throw new Error('cancelled');
    })).toThrow('cancelled');
    expect(recurringWorkElapsed(state, 'staff', 0)).toBeUndefined();
    withImmediateMaintenance(state, () => expect(recurringWorkElapsed(state, 'staff', 0)).toBe(0));
  });

  it.each([30, 60, 120])('caps work at 3 Hz at %i steps/second and retains elapsed time', hz => {
    const state = fixture(), times: number[] = []; let integrated = 0;
    for (let frame = 1; frame <= hz * 2 + 1; frame++) {
      state.time = frame / hz;
      const elapsed = recurringWorkElapsed(state, 'task', 1 / hz, 0);
      if (elapsed !== undefined) { times.push(state.time); integrated += elapsed; }
      expect(recurringWorkElapsed(state, 'task', 1 / hz)).toBeUndefined();
    }
    expect(times).toHaveLength(7);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(CHECK_INTERVAL - 1e-9);
    expect(integrated).toBeCloseTo(state.time, 10);
  });

  it('coalesces large gaps and resets on rewind or entity-store replacement', () => {
    const state = fixture();
    expect(recurringWorkElapsed(state, 'task', .1)).toBe(.1);
    state.time = .1; expect(recurringWorkElapsed(state, 'task', .1)).toBeUndefined();
    state.time = 10; expect(recurringWorkElapsed(state, 'task', 9.9)).toBe(10);
    expect(recurringWorkElapsed(state, 'task', 9.9)).toBeUndefined();
    state.time = 0; expect(recurringWorkElapsed(state, 'task', .1)).toBe(.1);
    resetEntities(state); expect(recurringWorkElapsed(state, 'task', .1)).toBe(.1);
  });

  it('spreads maintenance across frames without losing elapsed integration or consuming RNG', () => {
    const state = fixture(), initialRng = state.rngState;
    const keys = ['research', 'faction-development', 'faction-defenses', 'harvests', 'fog-raids', 'mass-levy', 'dead-entities'];
    const samples = keys.map(() => [] as number[]), integrated = keys.map(() => 0);
    for (let frame = 1; frame <= 120; frame++) {
      state.time = frame / 60;
      keys.forEach((key, index) => runRecurringWork(state, key, 1 / 60, elapsed => {
        samples[index].push(state.time); integrated[index] += elapsed;
      }));
    }
    expect(new Set(samples.map(times => times[1])).size).toBeGreaterThanOrEqual(4);
    samples.forEach((times, index) => {
      const interval = recurringWorkInterval(keys[index]);
      expect(times[0]).toBe(1 / 60);
      expect(times[1] - times[0]).toBeLessThanOrEqual(interval * 2 + 1 / 60);
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(interval - 1e-9);
      expect(integrated[index]).toBeCloseTo(times.at(-1)!, 10);
    });
    expect(state.rngState).toBe(initialRng);
  });

  it('caps real engine maintenance while a leader moves on every fast step', () => {
    const state = fixture(), observations = [
      vi.spyOn(farms, 'updateScheduledHarvests'), vi.spyOn(strategies, 'updateFactionStrategies'),
      vi.spyOn(levies, 'updateMassLevy'), vi.spyOn(construction, 'updateActiveConstruction'),
      vi.spyOn(sailing, 'resolveSailingPassengers'),
    ];
    const keys = ['harvests', 'faction-strategies', 'mass-levy', 'construction-completion', 'dead-entities'];
    const times = observations.map(() => [] as number[]);
    const input = { up: false, down: false, left: false, right: true };
    for (let frame = 0; frame < 120; frame++) {
      const before = observations.map(spy => spy.mock.calls.length), x = state.units[0].x;
      updateGame(state, 1 / 60, input);
      expect(state.units[0].x).toBeGreaterThan(x);
      observations.forEach((spy, i) => { if (spy.mock.calls.length > before[i]) times[i].push(state.time); });
    }
    times.forEach((samples, index) => {
      const interval = recurringWorkInterval(keys[index]);
      expect(samples.length).toBeGreaterThanOrEqual(Math.floor(2 / interval) - 1);
      expect(samples.length).toBeLessThanOrEqual(Math.floor(2 / interval));
      for (let i = 1; i < samples.length; i++) expect(samples[i] - samples[i - 1]).toBeGreaterThanOrEqual(interval - 1e-9);
    });
    for (let i = 0; i < observations.length; i++) expect(observations[i]).toHaveBeenCalledTimes(times[i].length);
    expect(state.units[0].x - 3.5).toBeGreaterThan(6);
  });
});
