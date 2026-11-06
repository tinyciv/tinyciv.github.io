import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { governingPalace, cityDevelopmentNeeds } from '../src/game/governor';
import { synchronizeFarms } from '../src/game/farms';
import { planHouseSite } from '../src/game/housing';
import { updateGame } from '../src/game/simulation';
import type { Building, GameState } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  return {
    world: { width: 40, height: 30, seed: 'governor-city-boundary', source: 'test', spawns: [],
      tiles: Array.from({ length: 1200 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [
      { id: 1, kind: 'palace', faction: 0, x: 10, y: 14, hp: 650, maxHp: 650, capacity: 0, populationGrowth: -10000, governorNextPlanAt: 30, governorPermissions: { farms: true, housing: true } },
      { id: 2, kind: 'palace', faction: 0, x: 22, y: 14, hp: 650, maxHp: 650, capacity: 0, populationGrowth: -10000, governorNextPlanAt: 30, governorPermissions: { farms: false, housing: false } },
    ],
    units: [{ id: 3, kind: 'leader', faction: 0, x: 12.5, y: 14.5, hp: 100, morale: 100, attack: 0, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 2000, production: 0,
      population: 5, culture: 10000, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'governor-city-boundary', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 },
  };
}
function tick(state: GameState): void {
  state.time = (state.tick + 1) * 30 - .1; updateGame(state, .1, idle);
}

describe('per-city governor boundaries', () => {
  it('attributes sites to the closest completed friendly palace with a stable tie-break', () => {
    const state = fixture();
    expect(governingPalace(state, { x: 17, y: 15 }, 0)?.id).toBe(1);
    expect(governingPalace(state, { x: 17.1, y: 15 }, 0)?.id).toBe(2);
    state.buildings[1].construction = { startedAt: 0, duration: 45, waitingForBuilder: true };
    expect(governingPalace(state, { x: 24, y: 15 }, 0)?.id).toBe(1);
  });

  it('does not let an enabled governor build farms in a neighboring city with farms disabled', () => {
    const state = fixture();
    state.buildings[0].governorPermissions!.housing = false;
    for (const tile of state.world.tiles) tile.terrain = 'lake';
    const dry = (x: number, y: number) => { state.world.tiles[y * 40 + x].terrain = 'grassland'; };
    for (let y = 14; y <= 15; y++) for (let x = 10; x <= 11; x++) dry(x, y);
    for (let x = 12; x <= 22; x++) dry(x, 14);
    // A single-cell farm can use the narrow causeway, so reserve its enabled-city
    // half for roads to leave all available farm sites in the disabled city.
    for (let x = 12; x <= 17; x++) entityStore(state).buildings.add({ id: 100 + x, kind: 'road', faction: 0,
      x, y: 14, hp: 60, maxHp: 60, capacity: 0 });
    for (let y = 10; y <= 20; y++) for (let x = 18; x <= 30; x++) dry(x, y);
    expect(cityDevelopmentNeeds(state, state.buildings[0]).priority).toBe('farm');
    tick(state);
    expect(state.buildings.filter(building => building.kind === 'camp').map(({x,y}) => ({x,y}))).toEqual([]);
    // Opening a valid site in the enabled city's own area resumes construction.
    for (let x = 4; x <= 10; x++) dry(x, 14);
    dry(4, 15); dry(5, 15);
    state.world.revision = (state.world.revision ?? 0) + 1;
    tick(state);
    const farm = state.buildings.find(building => building.kind === 'camp')!;
    expect(farm).toBeDefined();
    expect(governingPalace(state, { x: farm.x + .5, y: farm.y + .5 }, 0)?.id).toBe(1);
  });

  it('does not let housing orders spill into a neighboring city with housing disabled', () => {
    const state = fixture(), palace = state.buildings[0];
    palace.governorPermissions!.farms = false;
    for (const tile of state.world.tiles) tile.overlay = 'forest';
    state.factions[0].population = 1;
    for (let i = 0; i < 4; i++) entityStore(state).buildings.add({ id: 20 + i, kind: 'camp', faction: 0,
      x: 8 + i % 2 * 4, y: 10 + Math.floor(i / 2) * 6, hp: 100, maxHp: 100, capacity: 0 } as Building);
    synchronizeFarms(state);
    state.world.tiles[14 * 40 + 19].overlay = 'none';
    expect(planHouseSite(state, palace, () => false)?.point).toEqual({ x: 19, y: 14 });
    expect(cityDevelopmentNeeds(state, palace).priority).toBe('house');
    tick(state);
    // Farmland in the enabled city's own border may now move out to make room.
    // The disabled neighboring city must still receive no housing orders.
    expect(state.buildings.filter(building => building.kind === 'house'
      && governingPalace(state, { x: building.x + .5, y: building.y + .5 }, 0)?.id === 2)).toHaveLength(0);
    state.world.tiles[12 * 40 + 13].overlay = 'none'; state.world.revision = (state.world.revision ?? 0) + 1;
    tick(state);
    const house = state.buildings.find(building => building.kind === 'house')!;
    expect(house).toBeDefined();
    expect(governingPalace(state, { x: house.x + .5, y: house.y + .5 }, 0)?.id).toBe(1);
  });
});
