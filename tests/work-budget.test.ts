import { describe, expect, it } from 'vitest';
import { entityStore, resetEntities } from '../src/game/entity-store';
import { ensureBuilders } from '../src/game/builders';
import { ensureCollectors, synchronizeFarms } from '../src/game/farms';
import { createRoadPurchase } from '../src/game/road-purchase';
import { advanceConstructionReconciliation, buildAt, constructionReconciliationPending, updateGame } from '../src/game/simulation';
import { withSimulationReads } from '../src/game/simulation-reads';
import { recurringWorkElapsed, recurringWorkInterval, withImmediateMaintenance, withRecurringWorkBudget } from '../src/game/work-cadence';
import { denseConstructionFixture } from './helpers/construction-preview';
import { fixture as researchFixture, building } from './helpers/research-income';
import type { GameState } from '../src/game/types';

const keys = ['farms:sync', 'harvests', 'fog-raids', 'collectors:staff'];
const fixture = () => ({ world: { width: 1, height: 1, tiles: [] }, units: [], buildings: [], time: 0 } as unknown as GameState);
const idle = { up: false, down: false, left: false, right: false };

describe('interactive recurring maintenance budget', () => {
  it('staggers initialization over four substeps while leaving ordinary calls immediate', () => {
    const state = fixture(), first = new Map<string, number>(), elapsed = new Map<string, number>();
    for (let step = 0; step < 4; step++) {
      state.time = step / 10;
      withRecurringWorkBudget(state, () => {
        let admitted = 0;
        for (const key of keys) {
          const due = recurringWorkElapsed(state, key, .1, 0);
          if (due !== undefined) { admitted++; first.set(key, step); elapsed.set(key, due); }
          expect(recurringWorkElapsed(state, key, .1, 0)).toBeUndefined();
        }
        expect(admitted).toBe(1);
        expect(recurringWorkElapsed(state, `ordinary-${step}`, .1, 0)).toBe(.1);
      });
    }
    expect([...first.values()]).toEqual([0, 1, 2, 3]);
    keys.forEach((key, index) => expect(elapsed.get(key)).toBeCloseTo((index + 1) * .1));
    const direct = fixture();
    keys.forEach(key => expect(recurringWorkElapsed(direct, key, .1, 0)).toBe(.1));
  });

  it('retains phase, bounded waiting and elapsed integration at the coarsest runtime timestep', () => {
    const state = fixture(), observed = new Map(keys.map(key => [key, [] as number[]]));
    const credits = new Map(keys.map(key => [key, 0]));
    for (let step = 0; step <= 600; step++) {
      state.time = step / 10;
      withRecurringWorkBudget(state, () => {
        let admitted = 0;
        for (const key of keys) {
          const due = recurringWorkElapsed(state, key, step ? .1 : 0, 0);
          if (due === undefined) continue;
          admitted++; observed.get(key)!.push(state.time); credits.set(key, credits.get(key)! + due);
          expect(credits.get(key)).toBeCloseTo(state.time, 8);
        }
        expect(admitted).toBeLessThanOrEqual(1);
      });
    }
    for (const key of keys) {
      const times = observed.get(key)!, interval = recurringWorkInterval(key);
      expect(times.length).toBeGreaterThan(60 / interval * .94);
      expect(times.length).toBeLessThanOrEqual(Math.floor(60 / interval) + 1);
      // Up to three extra .1-second turns beyond the observed due deadline.
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeLessThanOrEqual(interval + .4 + 1e-8);
    }
    withImmediateMaintenance(state, () => keys.forEach(key => {
      credits.set(key, credits.get(key)! + recurringWorkElapsed(state, key, 0, 0)!);
      expect(credits.get(key)).toBeCloseTo(60, 8);
    }));
  });

  it('keeps overdue FIFO position when callback order changes and coalesces a hitch', () => {
    const state = fixture();
    withRecurringWorkBudget(state, () => keys.forEach(key => recurringWorkElapsed(state, key, 0, 0)));
    state.time = 100;
    const admitted: string[] = [], credits = new Map<string, number>();
    for (let step = 0; step < 4; step++) {
      state.time = 100 + step / 10;
      withRecurringWorkBudget(state, () => {
        for (const key of [...keys].reverse()) {
          const due = recurringWorkElapsed(state, key, step ? .1 : 100, 0);
          if (due !== undefined) { admitted.push(key); credits.set(key, due); }
        }
      });
    }
    expect(admitted).toEqual(['harvests', 'fog-raids', 'collectors:staff', 'farms:sync']);
    admitted.forEach((key, index) => expect(credits.get(key)).toBeCloseTo(100 + index / 10, 8));
  });

  it('lets paused explicit publications bypass admission and remove their stale queue entries', () => {
    const state = fixture();
    withRecurringWorkBudget(state, () => keys.forEach(key => recurringWorkElapsed(state, key, .1, 0)));
    state.paused = true;
    withRecurringWorkBudget(state, () => withImmediateMaintenance(state, () => {
      keys.forEach((key, index) => {
        expect(recurringWorkElapsed(state, key, 0, 0)).toBe(index ? .1 : 0);
        expect(recurringWorkElapsed(state, key, 0, 0)).toBeUndefined();
      });
    }));
    state.paused = false; state.time = 1 / 3;
    withRecurringWorkBudget(state, () => {
      expect(recurringWorkElapsed(state, 'harvests', 1 / 3, 0)).toBeCloseTo(1 / 3);
    });
  });

  it.each(['world', 'tiles', 'store', 'rewind'] as const)('drops stale queue entries and credits after %s reset', change => {
    const state = fixture(); state.time = 10;
    withRecurringWorkBudget(state, () => keys.forEach(key => recurringWorkElapsed(state, key, .1, 0)));
    if (change === 'world') state.world = { ...state.world };
    if (change === 'tiles') state.world.tiles = [];
    if (change === 'store') resetEntities(state);
    if (change === 'rewind') state.time = 0;
    withRecurringWorkBudget(state, () => {
      expect(recurringWorkElapsed(state, 'collectors:staff', .2, 0)).toBe(.2);
      expect(recurringWorkElapsed(state, 'harvests', .2, 0)).toBeUndefined();
    });
  });

  it('closes nested budget scopes after an exception without imposing the budget on public calls', () => {
    const state = fixture();
    expect(() => withRecurringWorkBudget(state, () => {
      expect(recurringWorkElapsed(state, keys[0], 0, 0)).toBe(0);
      withRecurringWorkBudget(state, () => expect(recurringWorkElapsed(state, keys[1], 0, 0)).toBeUndefined());
      throw new Error('interrupted');
    })).toThrow('interrupted');
    expect(recurringWorkElapsed(state, keys[1], 0, 0)).toBe(0);
  });

  it('leaves paused UI cleanup to the frontend while public updates still drain it', () => {
    const state = denseConstructionFixture();
    withSimulationReads(state, () => { synchronizeFarms(state); ensureCollectors(state); ensureBuilders(state); });
    entityStore(state).units.retain(unit => !unit.builder);
    expect(createRoadPurchase(state, [{ x: 83, y: 69 }, { x: 84, y: 69 }]).step().placed).toBe(1);
    const now = state.time;
    for (let step = 0; step < 5; step++) updateGame(state, .1, idle, { interactive: true });
    expect(state.units.some(unit => unit.builder)).toBe(false);
    for (let step = 0; step < 4; step++) updateGame(state, .1, idle);
    expect(state.units.some(unit => unit.builder)).toBe(true);
    expect(advanceConstructionReconciliation(state)).toBe(false);
    expect(state.time).toBe(now);
  });

  it('publishes paused ordinary orders through the explicit frontend cleanup pump', () => {
    const state = denseConstructionFixture();
    withSimulationReads(state, () => { synchronizeFarms(state); ensureCollectors(state); ensureBuilders(state); });
    entityStore(state).units.retain(unit => !unit.builder);
    expect(constructionReconciliationPending(state)).toBe(false);
    expect(buildAt(state, 'irrigation', 83, 68).ok).toBe(true);
    const now = state.time, gold = state.factions[0].gold;
    expect(constructionReconciliationPending(state)).toBe(true);
    updateGame(state, .1, idle, { interactive: true });
    expect(state.units.some(unit => unit.builder)).toBe(false);
    let turns = 0;
    while (constructionReconciliationPending(state) && turns++ < 5) advanceConstructionReconciliation(state);
    expect(constructionReconciliationPending(state)).toBe(false);
    expect(state.units.some(unit => unit.builder)).toBe(true);
    expect(state.time).toBe(now);
    expect(state.factions[0].gold).toBe(gold);
  });

  it('keeps economy payments, consumption and research reservations on their original boundary', () => {
    const ordinary = researchFixture(); ordinary.units[1].hp = 0;
    Object.assign(ordinary.buildings[0], { capacity: 20, unhousedResidents: 20, populationGrowth: -1000,
      governorPermissions: { farms: false, housing: false } });
    entityStore(ordinary).buildings.add({ ...building(40, 'palace', 23, 15), capacity: 4, unhousedResidents: 0,
      populationGrowth: -1000, governorPermissions: { farms: false, housing: false } });
    ordinary.factions[0].nextRetinueAt = Infinity;
    const interactive = structuredClone(ordinary);
    const ledger = (state: GameState) => ({ tick: state.tick, food: state.factions[0].food, gold: state.factions[0].gold,
      population: state.factions[0].population, income: state.factions[0].incomeTotals, outlays: state.factions[0].goldLedger,
      research: state.factions[0].research });
    for (let tick = 1; tick <= 3; tick++) {
      ordinary.time = interactive.time = tick * 30 - .1;
      updateGame(ordinary, .1, idle); updateGame(interactive, .1, idle, { interactive: true });
      expect(ledger(interactive)).toEqual(ledger(ordinary));
      expect(interactive.tick).toBe(tick);
    }
  });
});
