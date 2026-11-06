import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { beginFogFrame, endFogFrame, pointInSight, refreshFogUnit, unitSightRadius, updateFog } from '../src/game/fog';
import { highGroundSightMultiplier, sightDistance } from '../src/game/sight';
import { type GameState, type Unit } from '../src/game/types';

function fixture(kind: Unit['kind'] = 'leader'): GameState {
  return {
    world: { width: 48, height: 36, seed: 'high-ground-sight', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 48 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .5, food: 2, production: 0, gold: 0, variation: .3 })) },
    units: [{ id: 1, kind, faction: 0, x: 16.5, y: 16.5, hp: 100, morale: 100, attack: 10, defense: 0,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    buildings: [], factions: [], time: 0, tick: 0, speed: 1, paused: false, gameOver: false, victory: false,
    events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
    seed: 'high-ground-sight', rngState: 1,
  };
}
function plateau(state: GameState, x0 = 12, y0 = 12, x1 = 20, y1 = 20, id = 1): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) state.world.tiles[y * state.world.width + x].ridge = id;
  state.world.revision!++;
}

describe('downhill unit visibility', () => {
  it.each(['leader', 'warrior', 'worker'] as const)('extends %s sight by exactly fifty percent only over lower tiles', kind => {
    const state = fixture(kind); plateau(state); plateau(state, 26, 12, 34, 20, 2);
    const scout = state.units[0], radius = unitSightRadius(scout), fog = updateFog(state);
    for (let y = 0; y < fog.height; y++) for (let x = 0; x < fog.width; x++) {
      const downhill = !state.world.tiles[y * fog.width + x].ridge;
      const expected = Math.hypot(x + .5 - scout.x, y + .5 - scout.y) <= radius * (downhill ? 1.5 : 1);
      expect(pointInSight(fog, x + .5, y + .5)).toBe(expected);
    }
    // A second plateau across the valley is still the same elevation.
    expect(highGroundSightMultiplier(state.world, scout, { x: 28.5, y: 16.5 })).toBe(1);
  });

  it('uses playable elevation levels rather than small terrain-generation height differences', () => {
    const state = fixture(), source = state.units[0], target = { x: 28.5, y: 16.5 };
    state.world.tiles[16 * 48 + 16].elevation = .95;
    state.world.tiles[16 * 48 + 28].elevation = .05;
    expect(highGroundSightMultiplier(state.world, source, target)).toBe(1);
    expect(pointInSight(updateFog(state), target.x, target.y)).toBe(false);
    plateau(state, 26, 14, 30, 18);
    expect(highGroundSightMultiplier(state.world, source, target)).toBe(1);
    expect(pointInSight(updateFog(state), target.x, target.y)).toBe(false);
  });

  it('retains forest attenuation and examines cover inside the extended sight band', () => {
    const state = fixture(); plateau(state);
    expect(pointInSight(updateFog(state), 28.5, 16.5)).toBe(true);
    for (let y = 0; y < state.world.height; y++) for (const x of [25, 26]) state.world.tiles[y * 48 + x].overlay = 'forest';
    state.world.revision!++;
    expect(sightDistance(state.world, state.units[0], 28.5, 16.5)).toBeCloseTo(10 + 2 / .3);
    expect(pointInSight(updateFog(state), 28.5, 16.5)).toBe(false);
    for (const tile of state.world.tiles) tile.overlay = 'forest';
    state.world.revision!++;
    // A continuous forest still cuts the increased range to 30%.
    delete state.world.tiles[16 * 48 + 20].ridge;
    expect(pointInSight(updateFog(state), 20.5, 16.5)).toBe(true); // 4 < 9 * 1.5 * .3
    expect(pointInSight(updateFog(state), 21.5, 16.5)).toBe(false);
    expect(pointInSight(updateFog(state), 19.5, 16.5)).toBe(false); // Equal elevation: 3 > 9 * .3
  });

  it('drops the live bonus when descending, including inside an active fog frame', () => {
    const state = fixture(); plateau(state);
    const scout = state.units[0], target = { x: 16.5, y: 27.5 };
    beginFogFrame(state);
    try {
      expect(pointInSight(updateFog(state), target.x, target.y)).toBe(true);
      scout.x = 21.5; refreshFogUnit(state, scout);
      const descended = updateFog(state);
      expect(pointInSight(descended, target.x, target.y)).toBe(false);
      expect(descended.explored[27 * 48 + 16]).toBe(1);
      scout.x = 16.5; refreshFogUnit(state, scout);
      expect(pointInSight(updateFog(state), target.x, target.y)).toBe(true);
      for (const tile of state.world.tiles) delete tile.ridge;
      state.world.revision!++;
      expect(pointInSight(updateFog(state), target.x, target.y)).toBe(false);
    } finally { endFogFrame(state); }
  });

  it('keeps an elevated building and a colocated unit as distinct cached sight sources', () => {
    const state = fixture('worker'); plateau(state);
    entityStore(state).buildings.add({ id: 2, kind: 'house', faction: 0, x: 16, y: 16, hp: 160, maxHp: 160, capacity: 4 });
    const combined = updateFog(state);
    expect(combined.sources.map(({ x, y, radius }) => [x, y, radius])).toEqual([[16.5, 16.5, 6], [16.5, 16.5, 6]]);
    expect(pointInSight(combined, 24.5, 16.5)).toBe(true);
    entityStore(state).units.replace([]);
    expect(pointInSight(updateFog(state), 24.5, 16.5)).toBe(false);
    expect(pointInSight(updateFog(state), 22.5, 16.5)).toBe(true);
  });

  it('lets a unit on the high-side ramp look downhill', () => {
    const state = fixture(); plateau(state);
    state.world.tiles[16 * 48 + 20].stair = 'west';
    state.units[0].x = 20.5;
    expect(pointInSight(updateFog(state), 32.5, 16.5)).toBe(true);
    expect(pointInSight(updateFog(state), 34.5, 16.5)).toBe(false);
  });
});
