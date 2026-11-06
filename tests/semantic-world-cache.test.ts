import { afterEach, describe, expect, it, vi } from 'vitest';
import { territory } from '../src/game/borders';
import { entityStore } from '../src/game/entity-store';
import { updateFog, pointInSight } from '../src/game/fog';
import { addPalaceRoadRing } from '../src/game/palace-roads';
import * as sight from '../src/game/sight';
import { markWorldChanged } from '../src/game/world-revisions';
import type { Building, GameState, Unit, World } from '../src/game/types';

afterEach(() => vi.restoreAllMocks());
function fixture(): GameState {
  const world: World = { width: 36, height: 28, seed: 'semantic-caches', source: 'test', revision: 0, spawns: [],
    tiles: Array.from({ length: 36 * 28 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 1, production: 1, gold: 0, variation: .5 })) };
  for (let y = 0; y < world.height; y++) for (const x of [12, 13]) world.tiles[y * world.width + x].overlay = 'forest';
  const leader: Unit = { id: 1, kind: 'leader', faction: 0, x: 10.5, y: 12.5, hp: 100, morale: 100,
    attack: 25, defense: 5, speed: 3.6, range: .85, order: 'follow', cooldown: 0, lastCombat: -100,
    moving: false, facing: 0, attackTime: 0 };
  const palace: Building = { id: 2, kind: 'palace', faction: 0, x: 3, y: 3, hp: 650, maxHp: 650, capacity: 10 };
  return { world, units: [leader], buildings: [palace], fields: [], factions: [{ id: 0, name: 'Test', color: '#38f', affinity: 100,
    relation: 'self', food: 100, gold: 0, production: 0, population: 1, culture: 0,
    yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false, events: [], particles: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, seed: world.seed, rngState: 1 };
}

describe('semantic world cache invalidation', () => {
  it('retains territory and sight patches while actual palace-road construction changes navigation', () => {
    const state = fixture(), ray = vi.spyOn(sight, 'sightDistance');
    const claims = territory(state), fog = updateFog(state), visible = fog.visible.slice(), revision = fog.revision;
    expect(ray.mock.calls.length).toBeGreaterThan(0);
    ray.mockClear();
    expect(addPalaceRoadRing(state, state.buildings[0])).toBeGreaterThan(0);
    expect(state.world.revision).toBeGreaterThan(0);
    expect(territory(state)).toBe(claims);
    expect(updateFog(state).visible).toEqual(visible);
    expect(fog.revision).toBe(revision);
    expect(ray).not.toHaveBeenCalled();
  });

  it.each(['classified', 'raw'] as const)('reveals sight immediately after %s woodland clearing', mode => {
    const state = fixture(), claims = territory(state), fog = updateFog(state);
    expect(pointInSight(fog, 17.5, 12.5)).toBe(false);
    for (const tile of state.world.tiles) tile.overlay = 'none';
    if (mode === 'classified') markWorldChanged(state.world, 'sight');
    else state.world.revision!++;
    expect(territory(state)).not.toBe(claims);
    expect(pointInSight(updateFog(state), 17.5, 12.5)).toBe(true);
  });

  it('keeps claim and sight-source changes live after structural-only revisions', () => {
    const state = fixture(), claims = territory(state);
    entityStore(state).units.replace([]);
    expect(pointInSight(updateFog(state), 3.5, 3.5)).toBe(true);
    state.buildings[0].faction = -1;
    markWorldChanged(state.world);
    expect(territory(state)).not.toBe(claims);
    expect(pointInSight(updateFog(state), 3.5, 3.5)).toBe(false);
  });
});
