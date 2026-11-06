import { describe, expect, it } from 'vitest';
import { buildAt, housingCapacity, updateGame } from '../src/game/simulation';
import { updateConstruction } from '../src/game/structures';
import { citySummaries } from '../src/game/cities';
import { cityDevelopmentNeeds } from '../src/game/governor';
import { importImmigrant } from '../src/game/immigration';
import { synchronizeFarms } from '../src/game/farms';
import { recordRetinuePopulationLoss } from '../src/game/city-support';
import { entityStore } from '../src/game/entity-store';
import type { Building, GameState, Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const building = (id: number, kind: Building['kind'], x: number, y: number, capacity = 0): Building => ({ id, kind, faction: 0, x, y,
  hp: 650, maxHp: 650, capacity, governorPermissions: { farms: false, housing: false }, governorNextPlanAt: Infinity });
const person = (id: number, kind: Unit['kind'], x: number, y: number): Unit => ({ id, kind, faction: 0, x, y, hp: 100, maxHp: 100,
  morale: 100, attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
function fixture(): GameState {
  return {
    world: { width: 56, height: 36, seed: 'city-bootstrap', source: 'test', spawns: [], revision: 1,
      tiles: Array.from({ length: 56 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 6, 12), { ...building(2, 'house', 9, 12, 2), residents: 2 },
      { ...building(3, 'house', 9, 11, 2), residents: 2 }],
    units: [person(10, 'leader', 30.5, 14.5)],
    factions: [{ id: 0, name: 'Roma', color: '#f34f59', affinity: 100, relation: 'self', food: 500, gold: 2000, production: 0,
      population: 4, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'city-bootstrap', rngState: 1,
    raiderCamps: [], marauderPacks: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 2 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 },
  };
}
function foundCity(state: GameState): Building {
  const result = buildAt(state, 'palace', 32, 14);
  expect(result.ok).toBe(true);
  const palace = state.buildings.find(b => b.kind === 'palace' && b.id !== 1)!;
  palace.governorPermissions = { farms: false, housing: false }; palace.governorNextPlanAt = Infinity;
  palace.construction = { startedAt: -90, duration: 90 };
  expect(updateConstruction(state)).toBe(true);
  synchronizeFarms(state);
  return palace;
}
function advance(state: GameState, seconds: number): void {
  for (let i = 0; i < seconds * 2; i++) updateGame(state, .5, idle);
}

describe('new palace settlement support', () => {
  it('adds four usable beds and four local food only when construction finishes', () => {
    const state = fixture();
    expect(buildAt(state, 'palace', 32, 14).ok).toBe(true);
    const palace = state.buildings.find(b => b.kind === 'palace' && b.id !== 1)!;
    expect(palace.capacity).toBe(4);
    expect(housingCapacity(state)).toBe(4);
    expect(citySummaries(state)).toHaveLength(1);
    palace.construction = { startedAt: -90, duration: 90 };
    updateConstruction(state);
    expect(housingCapacity(state)).toBe(8);
    expect(citySummaries(state).find(city => city.palace === palace)).toMatchObject({ population: 0, housing: 4, food: 4 });
    expect(cityDevelopmentNeeds(state, palace)).toMatchObject({ population: 0, housing: 4, foodCapacity: 4 });
  });

  it('grows from zero food, zero population, and no houses or farms to four, but needs agriculture to grow further', () => {
    const state = fixture(), palace = foundCity(state);
    entityStore(state).buildings.retain(b => b === palace || b.kind === 'road');
    state.factions[0].population = 0; state.factions[0].food = 0; state.factions[0].gold = 0;
    advance(state, 600);
    expect(state.factions[0].population).toBe(4);
    expect(citySummaries(state)[0]).toMatchObject({ population: 4, housing: 4, food: 0 });
    expect(palace.unhousedResidents).toBe(4);
    entityStore(state).buildings.add(building(500, 'house', 36, 14, 4));
    synchronizeFarms(state); advance(state, 120);
    expect(citySummaries(state)[0]).toMatchObject({ population: 4, housing: 6, food: 0 });
    expect(state.factions[0].population).toBe(4);
  });

  it('keeps a paid new-city immigrant through repeated updates and a casualty recruited in the capital', () => {
    const state = fixture(), palace = foundCity(state);
    expect(importImmigrant(state, palace).ok).toBe(true);
    expect(citySummaries(state).map(city => city.population)).toEqual([4, 1]);
    const casualty = { ...person(300, 'warrior', palace.x + 2.5, palace.y + 2.5), home: 1, hp: 1 };
    entityStore(state).units.add(casualty);
    state.projectiles = [{ attacker: 999, faction: -2, target: casualty.id, damage: 1000, elapsed: 0, duration: .1,
      start: { x: casualty.x + 1, y: casualty.y }, end: { x: casualty.x, y: casualty.y }, x: casualty.x + 1, y: casualty.y }];
    updateGame(state, .1, idle);
    expect(casualty.hp).toBe(0);
    for (let i = 0; i < 10; i++) synchronizeFarms(state);
    advance(state, 25);
    expect(citySummaries(state).map(city => city.population)).toEqual([3, 1]);
    expect(palace.unhousedResidents).toBe(1);
    const home = building(500, 'house', 36, 14, 4); entityStore(state).buildings.add(home);
    synchronizeFarms(state);
    expect(home.residents).toBe(1); expect(palace.unhousedResidents).toBe(0);
    expect(citySummaries(state).map(city => city.population)).toEqual([3, 1]);
  });

  it('charges a local casualty to that city, including a resident in palace quarters', () => {
    const state = fixture(), palace = foundCity(state);
    importImmigrant(state, palace);
    recordRetinuePopulationLoss(state, { ...person(300, 'warrior', 8, 14), home: palace.id, hp: 0 });
    synchronizeFarms(state);
    expect(citySummaries(state).map(city => city.population)).toEqual([4, 0]);
    expect(state.factions[0].population).toBe(4);
  });
});
