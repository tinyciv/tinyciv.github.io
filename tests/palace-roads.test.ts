import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { addPalaceRoadRing } from '../src/game/palace-roads';
import { startConstruction, updateConstruction } from '../src/game/structures';
import { canWalk } from '../src/game/pathfinding';
import { type Building, type GameState } from '../src/game/types';

function fixture(): { state: GameState; palace: Building } {
  const palace: Building = { id: 1, kind: 'palace', faction: 0, x: 5, y: 5, hp: 650, maxHp: 650, capacity: 0 };
  const state = {
    world: { width: 16, height: 16, revision: 0, seed: 'ring', source: 'test', spawns: [],
      tiles: Array.from({ length: 256 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [palace], units: [], fields: [], factions: [{ id: 0, gold: 500 }], time: 0,
  } as unknown as GameState;
  return { state, palace };
}

describe('new palace perimeter roads', () => {
  it('adds twelve completed exterior cells for free, without duplicates', () => {
    const { state, palace } = fixture();
    expect(addPalaceRoadRing(state, palace)).toBe(12);
    const roads = state.buildings.filter(building => building.kind === 'road');
    expect(new Set(roads.map(road => road.id)).size).toBe(12);
    for (const road of roads) {
      expect(road.x === 4 || road.x === 7 || road.y === 4 || road.y === 7).toBe(true);
      expect(road.construction).toBeUndefined();
      expect(road.faction).toBe(0);
    }
    expect(state.factions[0].gold).toBe(500);
    expect(addPalaceRoadRing(state, palace)).toBe(0);
  });

  it('appears when the palace finishes, rather than when its footprint is ordered', () => {
    const { state, palace } = fixture();
    startConstruction(palace, 0);
    expect(addPalaceRoadRing(state, palace)).toBe(0);
    state.time = 89.9; updateConstruction(state);
    expect(state.buildings).toHaveLength(1);
    state.time = 90; expect(updateConstruction(state)).toBe(true);
    expect(state.buildings.filter(building => building.kind === 'road')).toHaveLength(12);
  });

  it('preserves buildings, existing roads, water, and ledges while passing under friendly fields', () => {
    const { state, palace } = fixture();
    state.world.tiles[4 * 16 + 4].terrain = 'ocean';
    state.world.tiles[4 * 16 + 5].ridge = 1;
    entityStore(state).buildings.add({ ...palace, id: 2, kind: 'house', x: 6, y: 4, capacity: 4 },
      { ...palace, id: 3, kind: 'road', x: 7, y: 4, faction: 1 },
      { ...palace, id: 4, kind: 'camp', x: 7, y: 5 });
    state.fields = [{ id: 10, camp: 4, faction: 0, x: 7, y: 5, planted: true, food: 5, nextHarvest: 30 }];
    expect(addPalaceRoadRing(state, palace)).toBe(8);
    const roads = state.buildings.filter(building => building.kind === 'road');
    expect(roads.some(road => road.x === 7 && road.y === 5)).toBe(true);
    expect(roads.find(road => road.x === 7 && road.y === 4)?.faction).toBe(1);
    expect(state.fields[0].food).toBe(5);
    expect(roads.some(road => road.x === 4 && road.y === 4 || road.x === 5 && road.y === 4 || road.x === 6 && road.y === 4)).toBe(false);
  });

  it('opens a friendly wall gate and skips hostile occupied tiles', () => {
    const { state, palace } = fixture();
    entityStore(state).buildings.add({ ...palace, id: 2, kind: 'wall', x: 5, y: 4 },
      { ...palace, id: 3, kind: 'wall', x: 6, y: 4, faction: 1 });
    expect(canWalk(state, 5, 4, 0)).toBe(false);
    addPalaceRoadRing(state, palace);
    expect(canWalk(state, 5, 4, 0)).toBe(true);
    expect(canWalk(state, 6, 4, 0)).toBe(false);
  });
});
