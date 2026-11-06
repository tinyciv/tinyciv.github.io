import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { buildingAlignmentBonus, buildingAlignmentQuery } from '../src/game/placement';
import { beginUnitFrame, endUnitFrame, nearbyBuildings } from '../src/game/spatial';
import { buildingSize, type Building, type GameState, type Point } from '../src/game/types';

const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0, hp = 100): Building =>
  ({ id, kind, x, y, faction, hp, maxHp: 100, capacity: 0 });
function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'site-queries', source: 'test', spawns: [],
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .6, food: 2, production: 0, gold: 0, variation: .5 })) }, units: [], buildings: [
      building(8, 'house', 9, 9), building(3, 'palace', 3, 7), building(5, 'camp', 15, 3),
      building(1, 'wall', 10, 10), building(6, 'road', 12, 10), building(4, 'well', 11, 14, 1),
      building(7, 'house', 25, 18, 0, 0), building(2, 'blacksmith', 19, 19),
    ],
    factions: [], fields: [], time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false,
    victory: false, seed: 'site-queries', rngState: 1,
  };
}
function edgeDistance(point: Point, structure: Building): number {
  const size = buildingSize(structure);
  return Math.hypot(Math.max(structure.x - point.x, 0, point.x - structure.x - size),
    Math.max(structure.y - point.y, 0, point.y - structure.y - size));
}

describe('indexed site and building queries', () => {
  it.each([1, 2])('matches original alignment scores for footprint size %i', size => {
    const state = fixture(), query = buildingAlignmentQuery(state, 0, size);
    for (let y = 0; y < 24; y += .5) for (let x = 0; x < 32; x += .5) {
      expect(query(x, y)).toBe(buildingAlignmentBonus(state, 0, x, y, size));
    }
  });

  it('preserves exact-range matches and array order across bucket and footprint boundaries', () => {
    const state = fixture(); beginUnitFrame(state);
    try {
      for (const point of [{ x: 5.1, y: 7.5 }, { x: 9.5, y: 9.5 }, { x: .5, y: .5 }, { x: 16.9, y: 4.9 }]) {
        for (const radius of [.2, 1, 3, 8, Infinity]) {
          const expected = state.buildings.filter(site => edgeDistance(point, site) < radius);
          const actual = nearbyBuildings(state, point, radius).filter(site => edgeDistance(point, site) < radius);
          expect(actual).toEqual(expected);
        }
      }
    } finally { endUnitFrame(state); }
  });

  it('returns live buildings outside a frame and rebuilds membership on the next frame', () => {
    const state = fixture(), point = { x: 6.5, y: 6.5 };
    beginUnitFrame(state); endUnitFrame(state);
    const added = building(99, 'house', 6, 6); entityStore(state).buildings.add(added);
    expect(nearbyBuildings(state, point, 1)).toContain(added);
    beginUnitFrame(state);
    try { expect(nearbyBuildings(state, point, 1)).toContain(added); }
    finally { endUnitFrame(state); }
  });
});
