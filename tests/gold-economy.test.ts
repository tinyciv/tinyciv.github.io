import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { BUILD_COSTS, buildAt, createGame, migrateGame, validateBuildAt } from '../src/game/simulation';
import { updateFog } from '../src/game/fog';
import { buildingSize, type Building, type GameState, type World } from '../src/game/types';
import { BUILD_OPTIONS } from '../src/ui/build-controls';

function fixture(): GameState {
  const state: GameState = {
    world: { width: 32, height: 24, seed: 'gold-construction', source: 'test', spawns: [], tiles: Array.from({ length: 768 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 6, y: 10, hp: 650, maxHp: 650, capacity: 0 }],
    units: [{ id: 2, kind: 'leader', faction: 0, x: 14.5, y: 12.5, hp: 100, maxHp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 500, production: 0,
      population: 5, culture: 10000, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 10000, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: 2, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'gold-construction', rngState: 1,
    marauderPacks: [], raiderCamps: [], fogRaids: { nextAt: 10000, waves: 0, pressureVersion: 2 },
  };
  updateFog(state); return state;
}
function building(id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building {
  return { id, kind, faction, x, y, hp: 100, maxHp: 100, capacity: 0 };
}
function woodland(): World {
  return { width: 64, height: 48, seed: 'palace-woodland', source: 'test', spawns: [{ x: 10.5, y: 14.5 }, { x: 49.5, y: 30.5 }],
    tiles: Array.from({ length: 64 * 48 }, (_, index) => ({ terrain: 'grassland', overlay: index % 2 ? 'forest' : 'jungle',
      elevation: .4, moisture: .7, food: 2, production: 1, gold: 0, variation: .5 })) };
}
function palaceDistance(x: number, y: number, palace: Building): number {
  const size = buildingSize(palace);
  return Math.hypot(Math.max(palace.x - x - .5, 0, x + .5 - palace.x - size),
    Math.max(palace.y - y - .5, 0, y + .5 - palace.y - size));
}
function expectClearPalaces(state: GameState): void {
  const palaces = state.buildings.filter(building => building.kind === 'palace');
  expect(palaces.length).toBeGreaterThan(0);
  for (const palace of palaces) for (let y = 0; y < state.world.height; y++) for (let x = 0; x < state.world.width; x++)
    if (palaceDistance(x, y, palace) <= 5) expect(['forest', 'jungle']).not.toContain(state.world.tiles[y * state.world.width + x].overlay);
}

describe('gold construction and legacy structure migration', () => {
  it('keeps three-gold palisades available before the stronger thirty-gold stone walls', () => {
    const state = fixture(), faction = state.factions[0];
    faction.research = undefined; faction.gold = 2;
    expect(buildAt(state, 'palisade', 12, 10).ok).toBe(false);
    expect(faction.gold).toBe(2);
    faction.gold = 3;
    expect(buildAt(state, 'palisade', 12, 10).ok).toBe(true);
    const palisade = state.buildings.at(-1)!;
    expect(palisade).toMatchObject({ kind: 'palisade', hp: 56.25, maxHp: 56.25,
      construction: { paidGold: 3, duration: 4, waitingForBuilder: true } });
    expect(faction.gold).toBe(0);
    faction.gold = 30;
    expect(validateBuildAt(state, 'wall', 13, 10).message).toContain('Masonry');
    faction.research = { focus: 'wall', levels: { wall: 1 }, progress: {} };
    expect(buildAt(state, 'wall', 13, 10).ok).toBe(true);
    expect(state.buildings.at(-1)!.maxHp).toBe(palisade.maxHp * 40);
    expect(BUILD_OPTIONS.find(option => option.kind === 'palisade')?.label).toBe('Palisade');
  });

  it.each([['camp', 12.5, 13, 8], ['house', 62.5, 11, 8]] as const)('charges exactly %s gold price at its affordability boundary', (kind, cost, x, y) => {
    const state = fixture(), faction = state.factions[0];
    expect(BUILD_COSTS[kind]).toEqual({ gold: cost, production: 0, food: 0 });
    faction.gold = cost - 1; faction.production = 100000;
    expect(buildAt(state, kind, x, y).ok).toBe(false);
    expect(faction.gold).toBe(cost - 1); expect(state.buildings).toHaveLength(1);
    faction.gold = cost; faction.production = 0;
    expect(buildAt(state, kind, x, y).ok).toBe(true);
    expect(faction.gold).toBe(0); expect(faction.production).toBe(0); expect(faction.food).toBe(500);
    expect(state.buildings.at(-1)).toMatchObject({ kind, construction: { waitingForBuilder: true } });
  });

  it.each(['tower'] as const)('rejects retired %s orders without spending gold', kind => {
    const state = fixture();
    expect(BUILD_OPTIONS.some(option => option.kind === kind)).toBe(false);
    expect(validateBuildAt(state, kind, 12, 10).ok).toBe(false);
    expect(buildAt(state, kind, 12, 10).ok).toBe(false);
    expect(state.factions[0].gold).toBe(500); expect(state.buildings).toHaveLength(1);
  });

  it('keeps legacy walls as walls and preserves health ratios while applying current balance', () => {
    const state = fixture(), wall = { ...building(20, 'wall', 10, 6), hp: 225, maxHp: 450, armor: 4 };
    const tower = { ...building(21, 'tower', 18, 7), hp: 300, maxHp: 1200, armor: 15 };
    entityStore(state).buildings.add(wall, tower); state.buildMode = 'wall';
    migrateGame(state);
    expect(wall).toMatchObject({ kind: 'wall', hp: 112.5, maxHp: 225, armor: 2 });
    expect(tower).toMatchObject({ kind: 'woodenTower', hp: 150, maxHp: 600, armor: 6 });
    expect(state.buildMode).toBe('wall');
    migrateGame(state);
    expect(wall.hp / wall.maxHp).toBe(.5); expect(tower.hp / tower.maxHp).toBe(.25);
  });

  it('zeros legacy timber stock and production yields without changing gold or food', () => {
    const state = fixture(), faction = state.factions[0];
    faction.production = 999; faction.yields.production = 42; faction.gold = 371; faction.food = 209;
    migrateGame(state);
    expect(faction).toMatchObject({ production: 0, gold: 371, food: 209, yields: { production: 0 } });
    expect(Object.values(BUILD_COSTS).every(cost => cost.production === 0)).toBe(true);
  });

  it('cannot turn an enemy camp wall into a gate by placing a player road under it', () => {
    const state = fixture();
    entityStore(state).buildings.add({ ...building(20, 'wall', 12, 10, -2), raiderCamp: 1 }, building(21, 'road', 11, 10));
    const before = state.factions[0].gold;
    expect(buildAt(state, 'road', 12, 10).ok).toBe(false);
    expect(state.factions[0].gold).toBe(before);
    expect(state.buildings.some(building => building.kind === 'road' && building.x === 12 && building.y === 10)).toBe(false);
  });
});

describe('palace woodland clearings', () => {
  it('clears forest and jungle within five tiles of every starting palace while preserving distant woodland', () => {
    const state = createGame(woodland());
    expectClearPalaces(state);
    expect(state.buildings.filter(building => building.kind === 'palace')).toHaveLength(2);
    expect(state.world.tiles[0].overlay).toBe('jungle');
    expect(state.world.tiles[1].overlay).toBe('forest');
  });

  it('clears the complete five-tile footprint radius on load without removing trees just outside it', () => {
    const state = fixture(), palace = state.buildings[0];
    for (let y = 0; y < state.world.height; y++) for (let x = 0; x < state.world.width; x++)
      state.world.tiles[y * state.world.width + x].overlay = x % 2 ? 'forest' : 'jungle';
    const outside = (palace.y + 1) * state.world.width + palace.x + 7;
    expect(palaceDistance(palace.x + 7, palace.y + 1, palace)).toBe(5.5);
    const oldOuter = state.world.tiles[outside].overlay;
    migrateGame(state);
    expectClearPalaces(state);
    expect(state.world.tiles[outside].overlay).toBe(oldOuter);
    // Legacy jungle is normalized to the supported forest overlay on load.
    expect(state.world.tiles[0].overlay).toBe('forest');
  });
});
