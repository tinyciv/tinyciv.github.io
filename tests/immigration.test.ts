import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { citySummaries } from '../src/game/cities';
import { demolishBuildingsInArea } from '../src/game/area-tools';
import { synchronizeFarms } from '../src/game/farms';
import { immigrationStatus, importImmigrant } from '../src/game/immigration';
import { updateGame } from '../src/game/simulation';
import type { Building, GameState } from '../src/game/types';

function fixture(): GameState {
  const palace = (id: number, x: number, cityName: string): Building => ({ id, kind: 'palace', faction: 0, x, y: 10,
    cityName, hp: 650, maxHp: 650, capacity: 4, governorPermissions: { farms: false, housing: false } });
  const house = (id: number, x: number, residents: number): Building => ({ id, kind: 'house', faction: 0,
    x, y: 10, hp: 160, maxHp: 160, capacity: 2, residents });
  return {
    world: { width: 56, height: 28, seed: 'immigration', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 56 * 28 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [palace(1, 6, 'Roma'), palace(2, 34, 'Ostia'), house(3, 10, 2), house(4, 38, 2)],
    units: [{ id: 10, kind: 'leader', faction: 0, x: 35, y: 13, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false,
      facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Roma', color: '#f34f59', affinity: 100, relation: 'self', food: 500, gold: 300,
      production: 0, population: 4, yields: { food: -4, production: 0, gold: 4 }, nextRaid: Infinity,
      nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'immigration', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 2 },
  };
}

describe('palace immigration', () => {
  it('rejects a full selected city even when another city has vacant beds', () => {
    const state = fixture(), palace = state.buildings[1];
    palace.capacity = 0;
    const before = structuredClone(state);
    expect(immigrationStatus(state, palace)).toEqual({ available: false, reason: 'No vacant housing in this settlement.' });
    expect(importImmigrant(state, palace)).toEqual({ ok: false, message: 'No vacant housing in this settlement.' });
    expect(state).toEqual(before);
  });

  it('fills the last bed once and rejects further purchases without spending gold', () => {
    const state = fixture(), palace = state.buildings[1];
    palace.capacity = 1;
    expect(importImmigrant(state, palace).ok).toBe(true);
    const before = structuredClone(state);
    expect(importImmigrant(state, palace).ok).toBe(false);
    expect(state).toEqual(before);
    expect(citySummaries(state).find(city => city.palace.id === palace.id)).toMatchObject({ population: 3, housing: 3 });
  });

  it('adds exactly one resident to the selected city for 100 gold without taking food or growth credit', () => {
    const state = fixture(), palace = state.buildings[1], faction = state.factions[0];
    state.buildings[0].populationGrowth = .25; palace.populationGrowth = .75;
    expect(immigrationStatus(state, palace).available).toBe(true);
    expect(importImmigrant(state, palace)).toMatchObject({ ok: true });
    expect(faction).toMatchObject({ population: 5, gold: 200, food: 500 });
    expect(state.buildings.filter(building => building.kind === 'palace').map(building => building.populationGrowth)).toEqual([.25, .75]);
    expect(citySummaries(state).map(city => city.population)).toEqual([2, 3]);
    for (let step = 0; step < 20; step++) updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(citySummaries(state).map(city => city.population)).toEqual([2, 3]);
  });

  it('uses settlement beds before new houses and keeps residents assigned to their city', () => {
    const state = fixture(), palace = state.buildings[1];
    entityStore(state).buildings.replace(state.buildings.filter(building => building.id !== 4));
    state.factions[0].population = 2;
    expect(importImmigrant(state, palace).ok).toBe(true);
    expect(palace.unhousedResidents).toBe(1);
    expect(citySummaries(state).map(city => [city.population, city.housing])).toEqual([[2, 6], [1, 4]]);
    for (let step = 0; step < 10; step++) synchronizeFarms(state);
    expect(state.buildings.find(building => building.id === 3)!.residents).toBe(2);
    const house: Building = { id: 4, kind: 'house', faction: 0, x: 38, y: 10, hp: 160, maxHp: 160, capacity: 4 };
    entityStore(state).buildings.add(house);
    synchronizeFarms(state);
    expect(house.residents).toBe(1); expect(palace.unhousedResidents).toBe(0);
    expect(citySummaries(state).map(city => city.population)).toEqual([2, 1]);
    expect(state.factions[0].population).toBe(3);
  });

  it('charges every click and stops at insufficient gold without creating free residents', () => {
    const state = fixture(), palace = state.buildings[1];
    for (let click = 0; click < 3; click++) expect(importImmigrant(state, palace).ok).toBe(true);
    expect(state.factions[0]).toMatchObject({ population: 7, gold: 0 });
    expect(citySummaries(state).map(city => city.population)).toEqual([2, 5]);
    const before = structuredClone(state);
    expect(importImmigrant(state, palace)).toEqual({ ok: false, message: 'Need 100 gold.' });
    expect(state).toEqual(before);
  });

  it('preserves a city’s unhoused immigrant when an unrelated empty house is demolished', () => {
    const state = fixture(), palace = state.buildings[1];
    entityStore(state).buildings.replace(state.buildings.filter(building => building.id !== 4));
    state.buildings.find(building => building.id === 3)!.residents = 2;
    entityStore(state).buildings.add({ id: 21, kind: 'house', faction: 0, x: 11, y: 10, hp: 160, maxHp: 160, capacity: 2, residents: 2 });
    entityStore(state).buildings.add({ id: 20, kind: 'house', faction: 0, x: 14, y: 10, hp: 160, maxHp: 160, capacity: 2, residents: 0 });
    expect(importImmigrant(state, palace).ok).toBe(true);
    demolishBuildingsInArea(state, { x: 14, y: 10 }, { x: 14, y: 10 });
    expect(state.buildings.some(building => building.id === 20)).toBe(false);
    expect(state.factions[0].population).toBe(5);
    expect(palace.unhousedResidents).toBe(1);
    expect(citySummaries(state).map(city => city.population)).toEqual([4, 1]);
  });

  it.each(['poor', 'foreign', 'wrong building', 'removed', 'unfinished', 'destroyed', 'distant', 'dead Leader', 'defeated'] as const)
  ('rejects an unavailable palace without mutation: %s', reason => {
    const state = fixture(), palace = state.buildings[1];
    if (reason === 'poor') state.factions[0].gold = 99;
    if (reason === 'foreign') palace.faction = 1;
    if (reason === 'wrong building') entityStore(state).setBuildingKind(palace, 'house');
    if (reason === 'removed') entityStore(state).buildings.replace(state.buildings.filter((_, index) => index < (1) || index >= (1) + (1)));
    if (reason === 'unfinished') palace.construction = { startedAt: 0, duration: 90 };
    if (reason === 'destroyed') palace.hp = 0;
    if (reason === 'distant') state.units[0].y = 15.01;
    if (reason === 'dead Leader') state.units[0].hp = 0;
    if (reason === 'defeated') state.factions[0].defeated = true;
    const before = structuredClone(state);
    expect(immigrationStatus(state, palace).available).toBe(false);
    expect(importImmigrant(state, palace).ok).toBe(false);
    expect(state).toEqual(before);
  });
});
