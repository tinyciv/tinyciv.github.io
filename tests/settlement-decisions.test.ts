import { afterEach, describe, expect, it, vi } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { invalidateDecisions } from '../src/game/decision-schedule';
import { idleJobDecisionDue, invalidateSettlementDecisions, runSettlementDecision, type SettlementDecision } from '../src/game/settlement-decisions';
import { updateBuilder } from '../src/game/builders';
import { updateCollector, updateHarvests } from '../src/game/farms';
import * as capacity from '../src/game/peasant-capacity';
import type { GameState, Unit } from '../src/game/types';

function realm(): GameState {
  return {
    world: { width: 24, height: 18, seed: 'decision-cadence', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 24 * 18 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
    units: [], buildings: [{ id: 1, kind: 'palace', x: 3, y: 7, faction: 0, hp: 650, maxHp: 650, capacity: 0 },
      { id: 2, kind: 'camp', x: 12, y: 7, faction: 0, hp: 100, maxHp: 100, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 100, gold: 100,
      production: 0, population: 5, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'decision-cadence', rngState: 1,
    fields: [{ id: 181, camp: 2, faction: 0, x: 12, y: 7, food: 0, planted: true, nextHarvest: 30 }],
  };
}
function worker(state: GameState, builder: boolean): Unit {
  const unit: Unit = { id: 10, kind: 'worker', faction: 0, home: 1, x: 4, y: 8, hp: 50, maxHp: 50, morale: 100,
    attack: 0, defense: 0, speed: 2.2, range: 1.1, order: 'work', cooldown: 0, lastCombat: -60, moving: false,
    facing: 0, attackTime: 0, inside: true,
    ...(builder ? { builder: true, buildPhase: 'idle' } : { collector: true, collectorCamp: 2, collectPhase: 'idle' }) };
  entityStore(state).units.add(unit);
  return unit;
}
afterEach(() => vi.restoreAllMocks());

describe('staggered settlement decisions', () => {
  it('runs independent maintenance at three decisions per game second', () => {
    const state = realm(), tasks: SettlementDecision[] = ['builders', 'farms', 'collectors', 'trade'];
    const times = new Map(tasks.map(task => [task, [] as number[]]));
    for (let frame = 0; frame < 600; frame++) {
      state.time = frame / 60;
      for (const task of tasks) runSettlementDecision(state, task, () => times.get(task)!.push(state.time));
    }
    for (const decisions of times.values()) expect(decisions.length).toBeGreaterThanOrEqual(30);
    for (const decisions of times.values()) expect(decisions.length).toBeLessThanOrEqual(31);
    expect(new Set([...times.values()].map(decisions => decisions[1])).size).toBe(tasks.length);
  });

  it('coalesces structural edits, ownership, completion and population changes until the next sample', () => {
    const state = realm(), run = vi.fn();
    runSettlementDecision(state, 'farms', run);
    state.time = .001;
    expect(runSettlementDecision(state, 'farms', run)).toBe(false);
    entityStore(state).buildings.add({ id: 3, kind: 'house', faction: 0, x: 8, y: 8, hp: 160, maxHp: 160, capacity: 4 });
    expect(runSettlementDecision(state, 'farms', run)).toBe(false);
    state.buildings[1].faction = 1; invalidateDecisions(state);
    expect(runSettlementDecision(state, 'farms', run)).toBe(false);
    invalidateSettlementDecisions(state);
    expect(runSettlementDecision(state, 'farms', run)).toBe(false);
    state.factions[0].population++;
    expect(runSettlementDecision(state, 'farms', run)).toBe(false);
    state.world.revision!++;
    expect(runSettlementDecision(state, 'farms', run)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    state.time = 2 / 3;
    expect(runSettlementDecision(state, 'farms', run)).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(runSettlementDecision(state, 'farms', run)).toBe(false);
  });

  it('coalesces callback and unit membership mutations into the next staffing sample', () => {
    const state = realm();
    expect(runSettlementDecision(state, 'builders', () => worker(state, true))).toBe(true);
    expect(runSettlementDecision(state, 'builders', () => {})).toBe(false);
    runSettlementDecision(state, 'farms', () => {});
    entityStore(state).units.retain(() => false);
    expect(runSettlementDecision(state, 'builders', () => {})).toBe(false);
    expect(runSettlementDecision(state, 'farms', () => {})).toBe(false);
    state.time = 2 / 3;
    expect(runSettlementDecision(state, 'builders', () => {})).toBe(true);
  });

  it('does not scan entity properties to check an idle maintenance deadline', () => {
    const state = realm();
    runSettlementDecision(state, 'farms', () => {});
    const kind = state.buildings[0].kind, read = vi.fn(() => kind);
    Object.defineProperty(state.buildings[0], 'kind', { configurable: true, get: read });
    state.time = .001;
    expect(runSettlementDecision(state, 'farms', () => {})).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('worker decisions and continuous execution', () => {
  it.each([true, false])('samples an idle %s builder/courier capacity check at three Hz', builder => {
    const state = realm(), unit = worker(state, builder), dispatch = vi.spyOn(capacity, 'canDispatchPeasant');
    state.factions[0].population = 0;
    for (let step = 0; step < 100; step++) {
      state.time = step / 100;
      (builder ? updateBuilder : updateCollector)(state, unit, .01, () => {});
    }
    expect(dispatch.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(dispatch.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('preserves route retry backoffs and samples a reset retry at the next deadline', () => {
    const state = realm(), unit = worker(state, true);
    expect(idleJobDecisionDue(state, unit)).toBe(true);
    unit.repathAt = 2; state.time = .01;
    expect(idleJobDecisionDue(state, unit)).toBe(false);
    unit.repathAt = 0;
    expect(idleJobDecisionDue(state, unit)).toBe(false);
    state.time = 2 / 3;
    expect(idleJobDecisionDue(state, unit)).toBe(true);
  });

  it('coalesces membership and population changes for a capacity-blocked worker', () => {
    const state = realm(), unit = worker(state, true);
    expect(idleJobDecisionDue(state, unit)).toBe(true);
    expect(idleJobDecisionDue(state, unit)).toBe(false);
    const other = { ...unit, id: 11, inside: false };
    entityStore(state).units.add(other);
    expect(idleJobDecisionDue(state, unit)).toBe(false);
    entityStore(state).units.retain(candidate => candidate !== other);
    expect(idleJobDecisionDue(state, unit)).toBe(false);
    state.factions[0].population++;
    expect(idleJobDecisionDue(state, unit)).toBe(false);
    state.time = 2 / 3;
    expect(idleJobDecisionDue(state, unit)).toBe(true);
  });

  it.each([true, false])('moves an assigned %s builder/courier on every step', builder => {
    const state = realm(), unit = worker(state, builder), move = vi.fn();
    unit.inside = false; unit.x = 7; unit.y = 7;
    unit.destination = { x: 12.5, y: 7.5 }; unit.path = [{ ...unit.destination }];
    if (builder) {
      state.buildings[1].construction = { startedAt: 0, duration: 20, waitingForBuilder: true, builderId: unit.id };
      unit.buildSite = 2; unit.buildPhase = 'outbound';
    } else {
      unit.collectPhase = 'outbound'; unit.field = state.fields![0].id;
      state.fields![0].food = 2; state.fields![0].claimedBy = unit.id;
    }
    for (let step = 0; step < 20; step++) {
      state.time = step / 100;
      (builder ? updateBuilder : updateCollector)(state, unit, .01, move);
    }
    expect(move).toHaveBeenCalledTimes(20);
  });

  it('picks up arrivals and processes harvest/spoilage deadlines between decision times', () => {
    const state = realm(), unit = worker(state, false), field = state.fields![0];
    runSettlementDecision(state, 'farms', () => {});
    field.nextHarvest = .01; state.time = .01; updateHarvests(state);
    expect(field.food).toBeGreaterThan(0);
    unit.inside = false; unit.collectPhase = 'outbound'; unit.field = field.id; field.claimedBy = unit.id;
    unit.x = field.x + .5; unit.y = field.y + .5;
    updateCollector(state, unit, .01, () => {});
    expect(unit.cargo).toBeGreaterThan(0); expect(field.food).toBe(0);
    unit.collectPhase = 'idle'; unit.inside = true; unit.cargoBatches = [{ amount: unit.cargo!, expiresAt: .02 }];
    updateCollector(state, unit, .001, () => {});
    state.time = .02; updateCollector(state, unit, .01, () => {});
    expect(unit.cargo).toBe(0);
  });
});
