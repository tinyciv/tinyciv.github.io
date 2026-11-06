import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { citySummaries } from '../src/game/cities';
import { cityDevelopmentNeeds } from '../src/game/governor';
import { synchronizeFarms } from '../src/game/farms';
import { updateGame } from '../src/game/simulation';
import type { GameState } from '../src/game/types';

function fixture(population: number): GameState {
  const state: GameState = {
    world: { width: 48, height: 40, seed: 'city-food-capacity', source: 'test', spawns: [],
      tiles: Array.from({ length: 48 * 40 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 4, y: 4, hp: 650, maxHp: 650, capacity: 0, populationGrowth: .5 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 5.5, y: 7.5, hp: 100, morale: 100, attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Home', color: '#3988ff', affinity: 100, relation: 'self', population, food: 0, gold: 0, production: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'city-food-capacity', rngState: 1,
    raiderCamps: [], marauderPacks: [], fogRaids: { nextAt: 1e9, waves: 0 },
  };
  let id = 10;
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++)
    entityStore(state).buildings.add({ id: id++, kind: 'camp', faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 });
  synchronizeFarms(state);
  return state;
}

describe('city food capacity', () => {
  it('does not cap potential harvest or governor food targets for a large city', () => {
    const state = fixture(450);
    expect(state.fields).toHaveLength(400);
    expect(citySummaries(state)[0].food).toBeCloseTo(160 * 4 / 3 - 450);
    const needs = cityDevelopmentNeeds(state, state.buildings[0]);
    expect(needs.foodCapacity).toBeLessThan(160 * 4 / 3 * .9);
    expect(needs.foodTarget).toBeCloseTo(450 * 1.12);
    expect(needs.priority).toBe('farm');
  });

  it('allows more farms to increase potential supply without granting food before delivery', () => {
    const state = fixture(100);
    expect(citySummaries(state)[0].food).toBeCloseTo(160 * 4 / 3 - 100);
    expect(citySummaries(state)[0].food).toBeGreaterThan(0);
    expect(cityDevelopmentNeeds(state, state.buildings[0]).foodCapacity).toBeLessThan(160 * 4 / 3 * .9);
    expect(state.factions[0].food).toBe(0);
  });

  it('reports actual missed meals even when fields could theoretically feed everyone', () => {
    const state = fixture(20), faction = state.factions[0];
    state.buildings[0].governorPermissions = { farms: false, housing: false };
    state.time = 29.9;
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(faction.yields.food).toBeGreaterThan(0);
    expect(faction.food).toBe(0);
    expect(state.buildings[0].populationGrowth).toBeCloseTo(.2);
    expect(state.events.some(event => event.kind === 'warning' && event.text.includes('20 rations'))).toBe(true);
  });

  it('does not treat fractional delivery roundoff as a missing meal or growth penalty', () => {
    const state = fixture(20), faction = state.factions[0];
    state.buildings[0].governorPermissions = { farms: false, housing: false };
    faction.food = 20 - 1e-12;
    state.time = 29.9;
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(faction.food).toBe(0);
    expect(state.buildings[0].populationGrowth).toBe(.5);
    expect(state.events.some(event => event.kind === 'warning' && event.text.includes('rations'))).toBe(false);
  });

  it.each([[6, 1, 2], [8, 2, 0], [19, 4, 3], [20, 5, 0]])(
    'spends four food per birth with %s food after meals', (reserve, births, remainder) => {
      const state = fixture(4), faction = state.factions[0];
      state.buildings[0].governorPermissions = { farms: false, housing: false };
      for (let index = 0; index < 4; index++) entityStore(state).buildings.add({ id: 500 + index, kind: 'house', faction: 0,
        x: 7 + index, y: 3, hp: 200, maxHp: 200, capacity: 3, houseLevel: 2 });
      faction.food = faction.population + reserve;
      state.buildings[0].populationGrowth = 100;
      state.time = 29.9;
      updateGame(state, .1, { up: false, down: false, left: false, right: false });
      expect(faction.population).toBe(4 + births);
      expect(faction.food).toBe(remainder);
    });
});
