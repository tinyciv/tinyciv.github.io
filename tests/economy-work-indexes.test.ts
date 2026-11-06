import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { notifyRepairJobChanged, repairJobCandidates } from '../src/game/builder-jobs';
import { invalidateWorkerHomes, settlementBuildings, settlementWorkers } from '../src/game/settlement-rosters';
import { idleJobDecisionDue, runSettlementDecision } from '../src/game/settlement-decisions';
import { withSimulationReads } from '../src/game/simulation-reads';
import { updateSupplyDepots } from '../src/game/supply-train';
import { ensureBuilders } from '../src/game/builders';
import { ensureCollectors, synchronizeFarms } from '../src/game/farms';
import { markWorldChanged } from '../src/game/world-revisions';
import type { GameState, Unit } from '../src/game/types';

function worker(id = 10): Unit {
  return { id, kind: 'worker', faction: 0, home: 1, builder: true, buildPhase: 'idle', inside: true,
    x: 4, y: 8, hp: 50, maxHp: 50, morale: 100, attack: 0, defense: 0, speed: 2.2, range: 1.1,
    order: 'work', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
}
function fixture(): GameState {
  return {
    world: { width: 24, height: 18, seed: 'economy-indexes', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 432 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
    units: [worker()], buildings: [
      { id: 1, kind: 'palace', x: 3, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 0 },
      { id: 2, kind: 'palace', x: 16, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 0 },
      { id: 3, kind: 'house', x: 6, y: 7, faction: 0, hp: 100, maxHp: 100, capacity: 4 },
      { id: 4, kind: 'supplyDepot', x: 11, y: 7, faction: 0, hp: 100, maxHp: 100, capacity: 0 },
    ],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 100, gold: 100,
      production: 0, population: 5, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false,
      research: { focus: 'supplyTrain', levels: { supplyTrain: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'economy-indexes', rngState: 1, fields: [],
  };
}

describe('retained economic work', () => {
  it('coalesces event and periodic staffing requests into one production scan per interval', () => {
    const state = fixture();
    withSimulationReads(state, () => {
      synchronizeFarms(state); ensureBuilders(state); ensureCollectors(state);
      const house = state.buildings[2], hp = house.hp; let reads = 0;
      Object.defineProperty(house, 'hp', { configurable: true, enumerable: true,
        get: () => { reads++; return hp; } });
      for (let i = 1; i <= 19; i++) {
        state.time = i / 60;
        state.factions[0].population++;
        synchronizeFarms(state); ensureBuilders(state); ensureCollectors(state);
      }
      expect(reads).toBe(0);
      state.time = 1 / 3;
      synchronizeFarms(state); ensureBuilders(state); ensureCollectors(state);
      expect(reads).toBeGreaterThan(0);
    });
  });
  it('keeps city worker rosters through military recruitment and updates actual reassignment', () => {
    const state = fixture();
    withSimulationReads(state, () => {
      const before = settlementWorkers(state);
      expect(before.byCity.get(1)).toEqual([state.units[0]]);
      entityStore(state).units.add({ ...worker(11), kind: 'warrior', builder: false });
      expect(settlementWorkers(state)).toBe(before);
      state.units[0].home = 2; invalidateWorkerHomes(state);
      const after = settlementWorkers(state);
      expect(after.byCity.has(1)).toBe(false);
      expect(after.byCity.get(2)).toEqual([state.units[0]]);
      entityStore(state).units.add(worker(12));
      expect(settlementWorkers(state).byCity.get(1)?.map(unit => unit.id)).toEqual([12]);
    });
  });

  it('updates structural city membership after ownership changes without navigation invalidation', () => {
    const state = fixture();
    withSimulationReads(state, () => {
      const before = settlementBuildings(state);
      expect(before.housesByFaction.get(0)).toHaveLength(1);
      state.buildings[2].faction = 1; markWorldChanged(state.world, 'structure');
      const after = settlementBuildings(state);
      expect(after.housesByFaction.has(0)).toBe(false);
      expect(after.housesByFaction.get(1)).toEqual([state.buildings[2]]);
    });
  });

  it('queues population and membership changes until the next city and idle-worker sample', () => {
    const state = fixture(), unit = state.units[0];
    for (const task of ['builders', 'farms', 'collectors'] as const) runSettlementDecision(state, task, () => {});
    idleJobDecisionDue(state, unit); state.time = .001;
    markWorldChanged(state.world, 'appearance');
    entityStore(state).units.add({ ...worker(11), kind: 'warrior', builder: false });
    for (const task of ['builders', 'farms', 'collectors'] as const)
      expect(runSettlementDecision(state, task, () => {})).toBe(false);
    expect(idleJobDecisionDue(state, unit)).toBe(false);
    state.factions[0].population++;
    expect(runSettlementDecision(state, 'builders', () => {})).toBe(false);
    expect(idleJobDecisionDue(state, unit)).toBe(false);
    entityStore(state).units.add(worker(12));
    expect(runSettlementDecision(state, 'builders', () => {})).toBe(false);
    state.time = 2 / 3;
    expect(runSettlementDecision(state, 'builders', () => {})).toBe(true);
    expect(idleJobDecisionDue(state, unit)).toBe(true);
  });

  it('does not rescan faction revisions between decision deadlines, even after invalidation', () => {
    const state = fixture(), unit = state.units[0];
    runSettlementDecision(state, 'builders', () => {}); idleJobDecisionDue(state, unit);
    const population = state.factions[0].population;
    let reads = 0;
    Object.defineProperty(state.factions[0], 'population', { configurable: true, enumerable: true,
      get: () => { reads++; return population; } });
    for (let i = 1; i <= 19; i++) {
      state.time = i / 60;
      markWorldChanged(state.world, 'structure');
      expect(runSettlementDecision(state, 'builders', () => {})).toBe(false);
      expect(idleJobDecisionDue(state, unit)).toBe(false);
    }
    expect(reads).toBe(0);
    state.time = 2 / 3;
    expect(runSettlementDecision(state, 'builders', () => {})).toBe(true);
    expect(idleJobDecisionDue(state, unit)).toBe(true);
    expect(reads).toBeGreaterThan(0);
  });

  it('maintains damaged candidates immediately and avoids rescanning healthy structures', () => {
    const state = fixture(), house = state.buildings[2], healthy = state.buildings[0];
    withSimulationReads(state, () => {
      expect(repairJobCandidates(state, 0)).toEqual([]);
      house.hp = 50; notifyRepairJobChanged(state, house);
      expect(repairJobCandidates(state, 0)).toEqual([house]);
      let reads = 0;
      Object.defineProperty(healthy, 'hp', { configurable: true, enumerable: true, get: () => { reads++; return 650; } });
      for (let i = 0; i < 100; i++) expect(repairJobCandidates(state, 0)).toEqual([house]);
      expect(reads).toBe(0);
      house.hp = house.maxHp; notifyRepairJobChanged(state, house);
      expect(repairJobCandidates(state, 0)).toEqual([]);
      house.hp = 60; house.faction = 1; notifyRepairJobChanged(state, house);
      expect(repairJobCandidates(state, 0)).toEqual([]);
      expect(repairJobCandidates(state, 1)).toEqual([house]);
    });
  });

  it('does not inspect units or allocate IDs while depot dispatch is not due', () => {
    const state = fixture(); updateSupplyDepots(state);
    let unitReads = 0, idReads = 0;
    for (const unit of state.units) {
      const kind = unit.kind;
      Object.defineProperty(unit, 'kind', { configurable: true, enumerable: true, get: () => { unitReads++; return kind; } });
    }
    const house = state.buildings[2], id = house.id;
    Object.defineProperty(house, 'id', { configurable: true, enumerable: true, get: () => { idReads++; return id; } });
    for (let i = 1; i <= 120; i++) { state.time = i / 30; updateSupplyDepots(state); }
    expect(unitReads).toBe(0); expect(idReads).toBe(0);
  });
});
