import { describe, expect, it } from 'vitest';
import { citySummaries } from '../src/game/cities';
import { cityOwnership } from '../src/game/city-ownership';
import { entityStore, resetEntities } from '../src/game/entity-store';
import { cityDevelopmentNeeds, cityPlanningStats, governingPalace, withCityPlanning, withCityPlanningMutation } from '../src/game/governor';
import type { Building, GameState } from '../src/game/types';

function realm(): GameState {
  const make = (id: number, kind: Building['kind'], x: number): Building => ({ id, kind, x, y: 8,
    faction: 0, hp: 100, maxHp: 100, capacity: 4, ...(kind === 'house' ? { residents: 3 } : {}) });
  return {
    world: { width: 40, height: 24, seed: 'city-planning-cache', source: 'test', spawns: [],
      tiles: Array.from({ length: 960 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [make(1, 'palace', 4), make(2, 'palace', 28), make(3, 'house', 7), make(4, 'house', 31)],
    units: [], fields: [], factions: [{ id: 0, name: 'Test', color: '#f00', affinity: 100, relation: 'self',
      food: 100, gold: 100, production: 0, population: 6, yields: { food: 0, gold: 0, production: 0 },
      nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'city-planning-cache', rngState: 1,
  };
}

describe('city ownership and planning snapshots', () => {
  it('observes palace capture, death and completion without advancing time or a terrain revision', () => {
    const state = realm(), [first, second, house] = state.buildings;
    expect(cityOwnership(state).building(house)).toBe(first);
    first.faction = 1;
    expect(cityOwnership(state).building(house)).toBe(second);
    house.faction = 1;
    expect(cityOwnership(state).building(house)).toBe(first);
    first.hp = 0;
    expect(cityOwnership(state).building(house)).toBeUndefined();
    first.hp = 100; first.construction = { startedAt: 0, duration: 30 };
    expect(cityOwnership(state).building(house)).toBeUndefined();
    delete first.construction;
    expect(cityOwnership(state).building(house)).toBe(first);
  });

  it('updates moved buildings and palaces, and never retains removed palace identities', () => {
    const state = realm(), [first, second, house] = state.buildings;
    expect(cityOwnership(state).building(house)).toBe(first);
    house.x = 29;
    expect(cityOwnership(state).building(house)).toBe(second);
    first.x = 29; second.x = 2;
    expect(cityOwnership(state).building(house)).toBe(first);
    const replacement = { ...first, id: 10 };
    entityStore(state).buildings.replace([replacement, second, house]);
    expect(cityOwnership(state).building(house)).toBe(replacement);
    resetEntities(state);
    expect(governingPalace(state, house, 0)).toBe(replacement);
    entityStore(state).buildings.replace([house]);
    expect(cityOwnership(state).building(house)).toBeUndefined();
  });

  it('keeps direct scalar queries current after same-step population and housing changes', () => {
    const state = realm(), palace = state.buildings[0], house = state.buildings[2];
    expect(cityDevelopmentNeeds(state, palace)).toMatchObject({ population: 3, housing: 8 });
    house.capacity = 9; house.residents = 8; state.factions[0].population = 11;
    expect(cityDevelopmentNeeds(state, palace)).toMatchObject({ population: 8, housing: 13 });
    house.hp = 0;
    expect(citySummaries(state).find(city => city.palace === palace)?.housing).toBe(4);
  });

  it('shares a read phase across cities and refreshes all statistics after a mutation phase', () => {
    const state = realm(), [first, second, house] = state.buildings;
    withCityPlanning(state, () => {
      const before = citySummaries(state);
      expect(cityDevelopmentNeeds(state, first).population).toBe(3);
      expect(cityDevelopmentNeeds(state, second).population).toBe(3);
      expect(cityDevelopmentNeeds(state, first).population).toBe(3);
      expect(cityPlanningStats(state)).toEqual({ summaries: 1, needs: 2, hits: 1 });
      withCityPlanningMutation(state, () => {
        expect(citySummaries(state)[0].population).toBe(3);
        house.residents = 4; state.factions[0].population = 7;
        entityStore(state).buildings.add({ ...house, id: 5, x: 10, residents: 0,
          construction: { startedAt: 0, duration: 10 } });
        // Queries within the mutating callback itself must also be fresh.
        expect(citySummaries(state)[0].population).toBe(4);
        expect(cityDevelopmentNeeds(state, first)).toMatchObject({ population: 4, housing: 12 });
      });
      expect(citySummaries(state)).not.toBe(before);
      expect(cityDevelopmentNeeds(state, first)).toMatchObject({ population: 4, housing: 12 });
      // Pending beds count for planning but not completed housing summaries.
      expect(citySummaries(state)[0].housing).toBe(8);
    });
    house.residents = 1; state.factions[0].population = 4;
    expect(cityDevelopmentNeeds(state, first).population).toBe(1);
  });

  it('discards planning snapshots even when an order callback throws', () => {
    const state = realm(), first = state.buildings[0];
    expect(() => withCityPlanning(state, () => {
      cityDevelopmentNeeds(state, first);
      withCityPlanningMutation(state, () => { state.factions[0].population = 0; throw new Error('order failed'); });
    })).toThrow('order failed');
    expect(cityDevelopmentNeeds(state, first).population).toBe(0);
  });
});
