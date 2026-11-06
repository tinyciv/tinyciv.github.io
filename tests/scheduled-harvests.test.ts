import { describe, expect, it } from 'vitest';
import { entityStore, resetEntities } from '../src/game/entity-store';
import { farmFieldIndex } from '../src/game/farm-index';
import { beginCollectorFrame, endCollectorFrame, ensureCollectors, invalidateScheduledHarvests, synchronizeFarms,
  updateCollector, updateHarvests, updateScheduledHarvests } from '../src/game/farms';
import type { GameState, Unit } from '../src/game/types';
import { withSimulationReads } from '../src/game/simulation-reads';

function fixture(): GameState {
  const state: GameState = {
    world: { width: 24, height: 16, seed: 'scheduled-harvests', source: 'test', revision: 0, spawns: [],
      tiles: Array.from({ length: 384 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [
      { id: 1, kind: 'palace', x: 2, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 0 },
      ...[6, 7, 11].map((x, i) => ({ id: i + 2, kind: 'camp' as const, x, y: 7, faction: 0, hp: 100, maxHp: 100, capacity: 0 })),
    ],
    units: [], fields: [], factions: [{ id: 0, name: 'Test', color: '#f34f59', affinity: 100, relation: 'self',
      food: 20, gold: 20, production: 0, population: 0, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'scheduled-harvests', rngState: 1,
  };
  synchronizeFarms(state);
  return state;
}
function visitor(): Unit {
  return { id: 10, kind: 'leader', faction: 0, x: 6.5, y: 7.5, hp: 100, morale: 100, attack: 1,
    defense: 0, speed: 2.2, range: 1.1, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
}
const snapshot = (state: GameState) => JSON.parse(JSON.stringify(state));

describe('scheduled farm work', () => {
  it('matches full reconciliation through harvest, spoilage, dormancy, visits and skipped time', () => {
    const slow = fixture(), fast = structuredClone(slow);
    for (let time = 0; time <= 400; time += .5) {
      for (const state of [slow, fast]) {
        state.time = time;
        if (time === 125) entityStore(state).units.add(visitor());
        if (time === 160) entityStore(state).units.replace([]);
      }
      updateHarvests(slow); updateScheduledHarvests(fast);
      expect(snapshot(fast), `at ${time}`).toEqual(snapshot(slow));
    }
    slow.time = fast.time = 1000;
    updateHarvests(slow); updateScheduledHarvests(fast);
    expect(snapshot(fast)).toEqual(snapshot(slow));
  });

  it('matches orchard maturity and ownerless abandonment after explicit structural changes', () => {
    const slow = fixture(), fast = structuredClone(slow);
    for (const time of [0, 10, 119.99, 120, 131, 200, 210, 719.99, 720, 900]) {
      for (const state of [slow, fast]) {
        state.time = time;
        if (time === 10) {
          const camp = state.buildings.find(b => b.id === 4)!;
          camp.orchard = { startedAt: 10, readyAt: 120 }; camp.farmLastVisitedAt = 10;
          const field = state.fields!.find(f => f.camp === camp.id)!;
          field.orchard = camp.orchard; field.planted = false; field.nextHarvest = 120;
          invalidateScheduledHarvests(state);
        }
        if (time === 120) {
          state.buildings.find(b => b.id === 2)!.faction = -1;
          synchronizeFarms(state);
          invalidateScheduledHarvests(state);
        }
      }
      updateHarvests(slow); updateScheduledHarvests(fast);
      expect(snapshot(fast), `at ${time}`).toEqual(snapshot(slow));
    }
  });

  it('does not inspect quiet fields or rebuild collector indexes between deadlines', () => {
    const state = fixture(); updateScheduledHarvests(state);
    const index = farmFieldIndex(state);
    let reads = 0;
    for (const field of state.fields!) {
      let next = field.nextHarvest;
      Object.defineProperty(field, 'nextHarvest', { enumerable: true, configurable: true,
        get: () => { reads++; return next; }, set: value => { next = value; } });
    }
    for (let step = 1; step <= 120; step++) {
      state.time = step / 30;
      updateScheduledHarvests(state);
      beginCollectorFrame(state); endCollectorFrame(state);
      expect(farmFieldIndex(state)).toBe(index);
    }
    expect(reads).toBe(0);
  });

  it('retains field membership across unrelated construction and rebuilds at an explicit import boundary', () => {
    const state = fixture(), fields = state.fields!, index = farmFieldIndex(state);
    withSimulationReads(state, () => {
      entityStore(state).buildings.add({ id: 20, kind: 'road', x: 1, y: 1, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
      synchronizeFarms(state);
      expect(state.fields).toBe(fields);
      expect(farmFieldIndex(state)).toBe(index);
    });
    state.fields![0] = { ...state.fields![0] };
    resetEntities(state);
    expect(farmFieldIndex(state).fields.get(state.fields![0].id)).toBe(state.fields![0]);
    expect(farmFieldIndex(state)).not.toBe(index);
  });

  it('keeps a stationary visitor effective beyond stale dormancy deadlines', () => {
    const state = fixture(); entityStore(state).units.add(visitor());
    for (let time = 0; time <= 500; time++) { state.time = time; updateScheduledHarvests(state); }
    expect(state.buildings.find(b => b.id === 2)!.farmLastVisitedAt).toBe(500);
    expect(state.fields!.find(f => f.camp === 2)!.planted).toBe(true);
    entityStore(state).units.replace([]);
    state.time = 620; updateScheduledHarvests(state);
    expect(state.fields!.find(f => f.camp === 2)!.planted).toBe(false);
  });

  it('matches claims, pickup, cargo expiry and delivery across repeated courier trips', () => {
    const slow = fixture();
    slow.factions[0].population = 8; slow.buildings[0].capacity = 8;
    synchronizeFarms(slow); ensureCollectors(slow);
    const fast = structuredClone(slow);
    const move = (_state: GameState, unit: Unit, goal: { x: number; y: number }) => { unit.x = goal.x; unit.y = goal.y; };
    for (let step = 0; step <= 1800; step++) {
      slow.time = fast.time = step / 10;
      updateHarvests(slow); updateScheduledHarvests(fast);
      for (const state of [slow, fast]) {
        const update = () => {
          if (step % 3 === 0) ensureCollectors(state);
          beginCollectorFrame(state);
          for (const unit of state.units) if (unit.collector) updateCollector(state, unit, .1, move);
          endCollectorFrame(state);
        };
        // Compare harvest algorithms under the same bounded staffing/worker
        // schedule; standalone helper reconciliation intentionally stays immediate.
        withSimulationReads(state, update);
      }
      if (step % 10 === 0) expect(snapshot(fast), `at ${step / 10}`).toEqual(snapshot(slow));
    }
    expect(fast.buildings[0].foodDelivered).toBeGreaterThan(0);
  });
});
