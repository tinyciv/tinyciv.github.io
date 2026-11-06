import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { deliverFoodCargo } from '../src/game/food-cargo';
import { updateCollector } from '../src/game/farms';
import type { FoodBatch, GameState, Unit } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 20, height: 20, seed: 'cargo', source: 'test', spawns: [], tiles: Array.from({ length: 400 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 5, y: 5, hp: 650, maxHp: 650, capacity: 0 },
      { id: 2, kind: 'camp', faction: 0, x: 10, y: 5, hp: 100, maxHp: 100, capacity: 0 }],
    units: [], factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 0, gold: 500,
      production: 0, population: 4, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'cargo', rngState: 1,
  };
}

function courier(state: GameState, id: number, batches: FoodBatch[], x = 4.5, y = 5.5): Unit {
  const unit: Unit = { id, kind: 'worker', faction: 0, x, y, home: 1, collectorCamp: 2, collector: true,
    inside: false, collectPhase: 'returning', hp: 50, morale: 100, attack: 0, defense: 0, speed: 2.2,
    range: 1.1, order: 'work', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
    cargoBatches: batches, cargo: batches.reduce((sum, batch) => sum + batch.amount, 0),
    cargoExpiresAt: batches.length ? Math.min(...batches.map(batch => batch.expiresAt)) : undefined };
  entityStore(state).units.add(unit);
  return unit;
}

describe('perishable food delivery', () => {
  it.each([1, 1000, 1_000_000])('credits all %s surviving food immediately without an intake limit', amount => {
    const state = fixture(), palace = state.buildings[0];
    const unit = courier(state, 10, [{ amount, expiresAt: 100 }]);
    expect(deliverFoodCargo(state, palace, unit)).toBe(amount);
    expect(state.factions[0].food).toBe(amount);
    expect(palace.foodDelivered).toBe(amount);
    expect(unit.cargo).toBe(0);
    expect(unit.cargoBatches).toEqual([]);
    expect(unit.cargoExpiresAt).toBeUndefined();
    expect(deliverFoodCargo(state, palace, unit)).toBe(0);
    expect(state.factions[0].food).toBe(amount);
  });

  it('immediately accepts simultaneous deliveries through every side of the palace', () => {
    const state = fixture(), palace = state.buildings[0];
    const doors = [[4.5, 5.5], [7.5, 5.5], [5.5, 4.5], [5.5, 7.5]];
    const couriers = doors.map(([x, y], index) => courier(state, 10 + index, [{ amount: 10_000, expiresAt: 100 }], x, y));
    for (const unit of couriers) updateCollector(state, unit, .1, () => {});
    expect(palace.foodDelivered).toBe(40_000);
    expect(state.factions[0].food).toBe(40_000);
    expect(couriers.every(unit => unit.inside && unit.cargo === 0)).toBe(true);
  });

  it('rejects expired batches at the exact deadline while crediting every fresh batch', () => {
    const state = fixture(), palace = state.buildings[0];
    const unit = courier(state, 10, [{ amount: 8, expiresAt: 1 }, { amount: 2, expiresAt: 10 }]);
    state.time = 1;
    updateCollector(state, unit, .1, () => {});
    expect(unit.inside).toBe(true);
    expect(state.factions[0].food).toBe(2);
    expect(palace.foodDelivered).toBe(2);
    expect(state.particles.filter(particle => particle.text === '−8 food')).toHaveLength(1);
  });

  it('keeps food in transit unspendable until the courier reaches a palace door', () => {
    const state = fixture(), palace = state.buildings[0];
    const unit = courier(state, 10, [{ amount: 1000, expiresAt: 100 }], 10.5, 6.5);
    updateCollector(state, unit, .1, () => {});
    expect(unit.cargo).toBe(1000);
    expect(unit.cargoExpiresAt).toBe(100);
    expect(state.factions[0].food).toBe(0);
    expect(palace.foodDelivered ?? 0).toBe(0);
  });

  it('returns an empty courier inside without any artificial unloading wait', () => {
    const state = fixture(), unit = courier(state, 10, []);
    updateCollector(state, unit, .1, () => {});
    expect(unit.inside).toBe(true);
    expect(state.factions[0].food).toBe(0);
  });
});
