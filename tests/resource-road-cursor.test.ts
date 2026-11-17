import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { createResourceRoadCursor, resourceRoadJourney, type ResourceRoadProgress } from '../src/game/resource-roads';
import { withSimulationReads } from '../src/game/simulation-reads';
import { markWorldChanged } from '../src/game/world-revisions';
import type { Building, GameState } from '../src/game/types';

function fixture() {
  const city: Building = { id: 1, kind: 'palace', faction: 0, x: 3, y: 8, hp: 650, maxHp: 650, capacity: 20 };
  const state = { world: { width: 70, height: 30, revision: 0, seed: 'road-cursor', source: 'test', spawns: [],
    tiles: Array.from({ length: 2100 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, variation: .5, food: 3, gold: 0, production: 1 })) }, buildings: [city], fields: [], units: [],
    factions: [{ id: 0, name: 'Test', relation: 'self', population: 20 }], time: 0, tick: 0,
    events: [], particles: [], rngState: 1 } as unknown as GameState;
  const cells = [60 + 9 * 70];
  Object.assign(state.world.tiles[cells[0]], { resource: 'copper', resourceDeveloped: true });
  return { state, city, cells };
}

describe('resumable resource roads', () => {
  it('preserves the synchronous path while bounding both search and network work', () => {
    const { state, city, cells } = fixture();
    const expected = resourceRoadJourney(state, city, cells)!;
    const cursor = createResourceRoadCursor(state, city, cells);
    let result: ResourceRoadProgress | undefined, turns = 0;
    do {
      result = cursor.advance(17, 3); turns++;
      expect(result.expansions).toBeLessThanOrEqual(17);
      expect(result.validations).toBeLessThanOrEqual(3);
      expect(turns).toBeLessThan(1000);
    } while (!result.done);
    expect(turns).toBeGreaterThan(20);
    expect(result.journey).toEqual(expected);
    expect(state.buildings).toHaveLength(1);
  });

  it.each(['crop', 'building', 'edge', 'network'] as const)('rejects a changed %s dependency while corridor checks are suspended', change => {
    const { state, city, cells } = fixture(), path = resourceRoadJourney(state, city, cells)!.path;
    const cursor = createResourceRoadCursor(state, city, cells);
    const pending = cursor.advance(Infinity, 1);
    expect(pending.done).toBe(false); expect(pending.validations).toBe(1);
    const point = path[0], x = Math.floor(point.x), y = Math.floor(point.y);
    if (change === 'crop') state.fields!.push({ id: 90, camp: 90, faction: 0, x, y, planted: true, food: 4, nextHarvest: 30 });
    if (change === 'building') entityStore(state).buildings.add({ id: 90, kind: 'house', faction: 0, x, y, hp: 100, maxHp: 100, capacity: 4 });
    if (change === 'edge') state.world.tiles[y * 70 + x].waterfall = 'south';
    if (change === 'network') entityStore(state).buildings.add({ id: 90, kind: 'road', faction: 0, x: x + 1, y: y + 1, hp: 100, maxHp: 100, capacity: 0 });
    expect(cursor.advance(Infinity, 1)).toMatchObject({ done: true, invalidated: true });
  });

  it('finishes corridor checks despite sustained unrelated construction', () => {
    const { state, city, cells } = fixture(), expected = resourceRoadJourney(state, city, cells);
    const cursor = createResourceRoadCursor(state, city, cells);
    let result = withSimulationReads(state, () => cursor.advance(Infinity, 2, 'initial'));
    for (let turn = 0; !result.done && turn < 100; turn++) {
      entityStore(state).buildings.add({ id: 90 + turn, kind: 'road', faction: 0, x: turn % 60, y: 25,
        hp: 100, maxHp: 100, capacity: 0 });
      result = withSimulationReads(state, () => cursor.advance(Infinity, 2, `edit:${turn}`));
    }
    expect(result.done).toBe(true); expect(result.invalidated).toBeUndefined(); expect(result.journey).toEqual(expected);
  });

  it('checks live corridor cells changed during the search, before network validation begins', () => {
    const { state, city, cells } = fixture(), expected = resourceRoadJourney(state, city, cells)!;
    const cursor = createResourceRoadCursor(state, city, cells);
    expect(cursor.advance(1, 1).done).toBe(false);
    const point = expected.path[3], x = Math.floor(point.x), y = Math.floor(point.y);
    entityStore(state).buildings.add({ id: 90, kind: 'house', faction: 0, x, y, hp: 100, maxHp: 100, capacity: 4 });
    const result = cursor.advance(Infinity, Infinity);
    expect(result.done).toBe(true);
    expect(result.journey?.path.some(cell => cell.x === point.x && cell.y === point.y) ?? false).toBe(false);
  });

  it.each(['capture', 'remove', 'world', 'cancel'] as const)('cancels a suspended origin on %s and lets another query run', change => {
    const { state, city, cells } = fixture(), expected = resourceRoadJourney(state, city, cells);
    const cursor = createResourceRoadCursor(state, city, cells);
    expect(cursor.advance(1, 1).done).toBe(false);
    if (change === 'capture') city.faction = 1;
    if (change === 'remove') entityStore(state).buildings.retain(building => building !== city);
    if (change === 'world') state.world = { ...state.world };
    if (change === 'cancel') cursor.cancel();
    expect(cursor.advance()).toMatchObject({ done: true });
    city.faction = 0;
    if (change === 'remove') entityStore(state).buildings.add(city);
    markWorldChanged(state.world, 'structure', []);
    expect(resourceRoadJourney(state, city, cells)).toEqual(expected);
  });
});
