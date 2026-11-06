import { describe, expect, it } from 'vitest';
import { forbiddenCells, forbiddenRegions, forbiddenRevision, isForbidden, setForbiddenRectangle, unitRespectsForbidden } from '../src/game/forbidden-zones';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import type { GameState } from '../src/game/types';

function fixture(): GameState {
  return { world: { width: 12, height: 10, seed: 'forbidden', source: 'test', spawns: [], tiles: Array.from({ length: 120 }, () =>
    ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
    units: [], buildings: [], factions: [0, 1, 2].map(id => ({ id, name: `Faction ${id}`, color: '#e00', affinity: 0,
      relation: id === 0 ? 'self' : id === 1 ? 'confederated' : 'war', food: 0, gold: 0, production: 0, population: 0,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false })),
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'forbidden', rngState: 1 };
}

describe('forbidden area designations', () => {
  it('clips reverse rectangles, costs nothing and does not explore fog', () => {
    const state = fixture();
    const result = setForbiddenRectangle(state, { x: 3.7, y: 2.6 }, { x: -8, y: -5 }, true);
    expect(result.count).toBe(12);
    expect(forbiddenCells(state).size).toBe(12);
    expect(state.factions[0].gold).toBe(0);
    expect(state.fog).toBeUndefined();
    expect(isForbidden(state, 3.5, 2.5)).toBe(true);
    expect(isForbidden(state, 4, 2)).toBe(false);
    expect(isForbidden(state, -1, 1)).toBe(false);
  });

  it('merges touching rectangles and splits them when the bridge is erased', () => {
    const state = fixture();
    setForbiddenRectangle(state, { x: 1, y: 2 }, { x: 2, y: 3 }, true);
    setForbiddenRectangle(state, { x: 4, y: 2 }, { x: 5, y: 3 }, true);
    expect(forbiddenRegions(state)).toHaveLength(2);
    setForbiddenRectangle(state, { x: 3, y: 2 }, { x: 3, y: 3 }, true);
    expect(forbiddenRegions(state)).toHaveLength(1);
    setForbiddenRectangle(state, { x: 3, y: 2 }, { x: 3, y: 3 }, false);
    expect(forbiddenRegions(state)).toHaveLength(2);
    setForbiddenRectangle(state, { x: 1, y: 2 }, { x: 5, y: 3 }, false);
    expect(forbiddenRegions(state)).toHaveLength(0);
  });

  it('uses one marker for corner-touching cells without wrapping map edges', () => {
    const state = fixture();
    setForbiddenRectangle(state, { x: 1, y: 1 }, { x: 1, y: 1 }, true);
    setForbiddenRectangle(state, { x: 2, y: 2 }, { x: 2, y: 2 }, true);
    expect(forbiddenRegions(state)).toHaveLength(1);
    setForbiddenRectangle(state, { x: 11, y: 4 }, { x: 11, y: 4 }, true);
    setForbiddenRectangle(state, { x: 0, y: 5 }, { x: 0, y: 5 }, true);
    expect(forbiddenRegions(state)).toHaveLength(3);
  });

  it('keeps the marker inside concave zones and caches unchanged components', () => {
    const state = fixture();
    setForbiddenRectangle(state, { x: 2, y: 2 }, { x: 7, y: 7 }, true);
    setForbiddenRectangle(state, { x: 3, y: 3 }, { x: 6, y: 6 }, false);
    const regions = forbiddenRegions(state), center = regions[0].center;
    expect(regions).toHaveLength(1);
    expect(isForbidden(state, center.x, center.y)).toBe(true);
    expect(forbiddenRegions(state)).toBe(regions);
    const revision = forbiddenRevision(state);
    expect(setForbiddenRectangle(state, { x: 2, y: 2 }, { x: 2, y: 2 }, true).count).toBe(0);
    expect(forbiddenRevision(state)).toBe(revision);
    expect(forbiddenRegions(state)).toBe(regions);
  });

  it('restricts friendly workers, merchants and guards while exempting retinue and enemies', () => {
    const state = fixture();
    setForbiddenRectangle(state, { x: 1, y: 1 }, { x: 2, y: 2 }, true);
    for (const kind of ['worker', 'merchant', 'militia', 'scout'] as const) {
      expect(unitRespectsForbidden(state, { kind, faction: 0 })).toBe(true);
      expect(unitRespectsForbidden(state, { kind, faction: 1 })).toBe(true);
      expect(unitRespectsForbidden(state, { kind, faction: 2 })).toBe(false);
    }
    for (const kind of ['leader', 'warrior', 'archer'] as const)
      expect(unitRespectsForbidden(state, { kind, faction: 0 })).toBe(false);
    expect(isForbidden(state, 1, 1, 2)).toBe(false);
  });

  it('round-trips regions through the real game save without changing tile terrain', () => {
    const state = fixture();
    const terrain = JSON.stringify(state.world.tiles);
    setForbiddenRectangle(state, { x: 3, y: 2 }, { x: 6, y: 5 }, true);
    const restored = parseGameSave(serializeGameSave(state));
    expect(restored.forbiddenZones).toEqual(state.forbiddenZones);
    expect(forbiddenRegions(restored)).toEqual(forbiddenRegions(state));
    expect(JSON.stringify(state.world.tiles)).toBe(terrain);
    expect(setForbiddenRectangle(state, { x: Infinity, y: 0 }, { x: 3, y: 3 }, true).count).toBe(0);
  });
});
