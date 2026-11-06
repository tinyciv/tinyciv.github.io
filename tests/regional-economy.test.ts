import { describe, expect, it } from 'vitest';
import { citySpecialties, regionalTradeMultiplier } from '../src/game/regional-economy';
import { movementMultiplier, travelTimeMap } from '../src/game/pathfinding';
import { type GameState, type World } from '../src/game/types';
import { entityStore } from '../src/game/entity-store';

function fixture(): GameState {
  const world: World = { width: 32, height: 16, seed: 'regional-economy', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 512 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) };
  return { world, units: [], buildings: [], factions: [], time: 0, tick: 0, paused: false, speed: 1,
    events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
    gameOver: false, victory: false, seed: world.seed, rngState: 1 };
}

describe('regional trade specialties', () => {
  it('rewards complementary deposits without rewarding duplicate specialties', () => {
    const { world } = fixture(), a = { x: 4, y: 8 }, b = { x: 25, y: 8 };
    for (let y = 6; y <= 8; y++) {
      world.tiles[y * world.width + 5].resource = 'clay';
      world.tiles[y * world.width + 26].resource = 'iron';
    }
    expect(citySpecialties(world, a)).toEqual(['clay']);
    expect(citySpecialties(world, b)).toEqual(['iron']);
    expect(regionalTradeMultiplier(world, a, b)).toBeCloseTo(1.10);
    for (let y = 6; y <= 8; y++) world.tiles[y * world.width + 26].resource = 'clay';
    world.revision!++;
    expect(regionalTradeMultiplier(world, a, b)).toBe(1);
  });

  it('requires local access, but allows working fisheries from the shore', () => {
    const { world } = fixture(), city = { x: 4, y: 8 };
    for (let y = 0; y < world.height; y++) {
      world.tiles[y * world.width + 7].terrain = 'river';
      world.tiles[y * world.width + 8].terrain = 'river';
    }
    for (let y = 6; y <= 8; y++) {
      world.tiles[y * world.width + 10].resource = 'iron';
      world.tiles[y * world.width + 7].resource = 'fish';
    }
    expect(citySpecialties(world, city)).toEqual(['fish']);
    world.tiles[8 * world.width + 7].overlay = 'ford';
    world.tiles[8 * world.width + 8].overlay = 'ford';
    world.revision!++;
    expect(citySpecialties(world, city)).toEqual(['iron', 'fish']);
  });

  it('unlocks deposits across a completed bridge and loses access when it is destroyed', () => {
    const state = fixture(), { world } = state, city = { x: 4, y: 8, faction: 0 };
    for (let y = 0; y < world.height; y++) {
      world.tiles[y * world.width + 7].terrain = 'river';
      world.tiles[y * world.width + 8].terrain = 'river';
    }
    for (let y = 6; y <= 8; y++) world.tiles[y * world.width + 10].resource = 'iron';
    expect(citySpecialties(world, city, state)).toEqual([]);
    entityStore(state).buildings.add(...[7, 8].map(x => ({ id: x, kind: 'bridge' as const, x, y: 8,
      faction: 0, hp: 100, maxHp: 100, capacity: 0 })));
    expect(citySpecialties(world, city, state)).toEqual(['iron']);
    state.buildings[0].hp = 0;
    expect(citySpecialties(world, city, state)).toEqual([]);
  });
});

describe('biome travel costs', () => {
  it('uses matching physical speed and path travel time, and refreshes changed biomes', () => {
    const state = fixture(), index = 8 * state.world.width + 5, origin = { x: 4.5, y: 8.5 };
    expect(travelTimeMap(state, origin, 0, 1, 10)[index]).toBeCloseTo(1);
    state.world.tiles[index].biome = 'wetland'; state.world.revision!++;
    expect(movementMultiplier(state, 5.5, 8.5)).toBe(.7);
    // Center-to-center travel spends half a tile on each surface.
    expect(travelTimeMap(state, origin, 0, 1, 10)[index]).toBeCloseTo(.5 + .5 / .7);
    entityStore(state).buildings.add({ id: 1, kind: 'road', x: 5, y: 8, faction: 0, hp: 100, maxHp: 100, capacity: 0 });
    expect(movementMultiplier(state, 5.5, 8.5)).toBe(1.5);
    expect(travelTimeMap(state, origin, 0, 1, 10)[index]).toBeCloseTo(.5 + .5 / 1.5);
  });
});
