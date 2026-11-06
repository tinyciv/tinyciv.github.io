import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { beginCollectorFrame, endCollectorFrame, ensureCollectors, synchronizeFarms, updateCollector } from '../src/game/farms';
import type { Building, GameState, Unit } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 24, height: 16, seed: 'collector-assignments', source: 'test', spawns: [],
      tiles: Array.from({ length: 384 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 2, 7), building(2, 'palace', 18, 7), building(3, 'camp', 6, 7), building(4, 'camp', 15, 7)],
    units: [], fields: [], factions: [{ id: 0, name: 'Test', color: '#f34f59', affinity: 100, relation: 'self',
      food: 20, gold: 20, production: 0, population: 6, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'collector-assignments', rngState: 1,
  };
}
function building(id: number, kind: Building['kind'], x: number, y: number): Building {
  return { id, kind, x, y, faction: 0, hp: 200, maxHp: 200, capacity: kind === 'palace' ? 3 : 0,
    unhousedResidents: kind === 'palace' ? 3 : undefined };
}
function courier(id: number, home = 1): Unit {
  return { id, kind: 'worker', faction: 0, x: 3, y: 8, hp: 50, maxHp: 50, morale: 100, attack: 0,
    defense: 0, speed: 2.2, range: 1.1, order: 'work', cooldown: 0, lastCombat: -60, moving: false,
    facing: 0, attackTime: 0, collector: true, collectPhase: 'idle', inside: true, home };
}

describe('farm courier assignment', () => {
  it('rechecks a cached home when its palace is sealed and when a breach opens without a terrain edit', () => {
    const state = fixture(); synchronizeFarms(state); ensureCollectors(state);
    const worker = state.units.find(unit => unit.collectorCamp === 3)!;
    expect(worker.home).toBe(1);
    let id = 100;
    for (let y = 6; y <= 9; y++) for (let x = 1; x <= 4; x++) {
      if (x === 1 || x === 4 || y === 6 || y === 9) entityStore(state).buildings.add(building(id++, 'wall', x, y));
    }
    ensureCollectors(state);
    expect(worker.home).toBe(2);
    state.buildings.find(site => site.kind === 'wall' && site.x === 4 && site.y === 7)!.hp = 0;
    ensureCollectors(state);
    expect(worker.home).toBe(1);
    expect(state.units.filter(unit => unit.collectorCamp === 3)).toEqual([worker]);
  });

  it('retains an assigned courier at home before a surplus courier already outside', () => {
    const state = fixture(); synchronizeFarms(state);
    const outside = { ...courier(10), collectorCamp: 3, inside: false }, inside = { ...courier(11), collectorCamp: 3 };
    entityStore(state).units.replace([outside, inside, { ...courier(12, 2), collectorCamp: 4 }]);
    ensureCollectors(state);
    expect(state.units.map(unit => unit.id)).toEqual([11, 12]);
    expect(inside.collectorCamp).toBe(3);
  });

  it('reuses unassigned approaching couriers before generic unassigned and orphaned couriers', () => {
    const state = fixture(); synchronizeFarms(state);
    const generic = courier(10), approaching = { ...courier(11), field: state.fields!.find(field => field.camp === 3)!.id };
    const orphaned = { ...courier(12), collectorCamp: 999 };
    entityStore(state).units.replace([orphaned, generic, approaching]);
    ensureCollectors(state);
    expect(approaching.collectorCamp).toBe(3);
    expect(generic.collectorCamp).toBe(4);
    expect(state.units.map(unit => unit.id)).toEqual([10, 11]);
    ensureCollectors(state);
    expect(state.units.map(unit => unit.id)).toEqual([10, 11]);
  });

  it('observes food and claim changes made during the shared collector frame', () => {
    const state = fixture(); synchronizeFarms(state); ensureCollectors(state);
    const worker = state.units.find(unit => unit.collectorCamp === 3)!;
    const field = state.fields!.find(plot => plot.camp === 3)!;
    beginCollectorFrame(state);
    try {
      field.food = 3;
      updateCollector(state, worker, .1, () => {});
      expect(worker.field).toBe(field.id);
      expect(field.claimedBy).toBe(worker.id);
      expect(worker.inside).toBe(false);
      field.food = 0;
      updateCollector(state, worker, .1, () => {});
      expect(worker.field).toBeUndefined();
      expect(field.claimedBy).toBeUndefined();
      expect(worker.collectPhase).toBe('idle');
    } finally { endCollectorFrame(state); }
  });

  it('rechecks plot membership after direct terrain edits without a revision bump', () => {
    const state = fixture(); synchronizeFarms(state); synchronizeFarms(state);
    const camp = state.buildings.find(building => building.id === 3)!;
    const tile = state.world.tiles[camp.y * state.world.width + camp.x];
    tile.terrain = 'lake';
    synchronizeFarms(state);
    expect(state.fields!.filter(field => field.camp === camp.id)).toHaveLength(0);
    expect(tile.farm).toBeUndefined();
    tile.terrain = 'grassland';
    synchronizeFarms(state);
    expect(state.fields!.filter(field => field.camp === camp.id)).toHaveLength(1);
    expect(tile.farm).toBe(camp.faction);
  });

  it('restores stored food and replants changed plots after a topology cache hit', () => {
    const state = fixture(); synchronizeFarms(state); synchronizeFarms(state);
    const camp = state.buildings.find(building => building.id === 3)!;
    const field = state.fields!.find(field => field.camp === camp.id)!;
    state.time = 90; field.planted = false; camp.storedFood = 7;
    const tile = state.world.tiles[field.y * state.world.width + field.x];
    tile.overlay = 'forest'; delete tile.farm;
    synchronizeFarms(state);
    expect(field.planted).toBe(true);
    expect(field.nextHarvest).toBeGreaterThanOrEqual(120);
    expect(field.food).toBe(7);
    expect(camp.storedFood).toBeUndefined();
    expect(tile.overlay).toBe('none');
    expect(tile.farm).toBe(camp.faction);
  });
});
