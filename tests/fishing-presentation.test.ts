import { describe, expect, it } from 'vitest';
import { updateFog, pointInSight, beginFogFrame, endFogFrame, invalidateFog } from '../src/game/fog';
import type { FishingBoat, FishingFish } from '../src/game/fishing';
import { fishSurfaceFrame } from '../src/game/fishing-art';
import { entityStore } from '../src/game/entity-store';
import { scoutRealm } from './helpers/scouts';
import { recordNativeFrame } from './helpers/native-renderer';

function fixture() {
  const state = scoutRealm(); entityStore(state).units.replace([]); entityStore(state).buildings.replace([]);
  for (const tile of state.world.tiles) tile.terrain = 'coast';
  const boat: FishingBoat = { id: 1, faction: 0, dock: 1, city: 2, x: 32.5, y: 20.5,
    hp: 80, home: { x: 32.5, y: 20.5 }, phase: 'idle', cargo: 0, facing: 0, moving: false, path: [], nextPlanAt: 0 };
  const fish: FishingFish = { id: 2, zone: 1, x: 34.5, y: 20.5, food: 5, spawnedAt: 0, facing: 0 };
  state.fishing = { seed: state.seed, startedAt: 0, sequence: 4, zones: [], fish: [fish, { ...fish, id: 3, x: 8.5 }],
    boats: [boat, { ...boat, id: 4, faction: 1, x: 8.5 }], receipts: [], replacements: {} };
  for (const current of state.fishing.fish) setSurfaceFrame(current, state.time, 3);
  return { state, boat };
}

function setSurfaceFrame(fish: FishingFish, time: number, frame: number): void {
  for (let age = 0; age < 35; age += .02) {
    fish.spawnedAt = time - age;
    if (fishSurfaceFrame(fish, time) === frame) return;
  }
  throw Error('Expected surface phase was unavailable');
}

describe('fishing presentation and local sight', () => {
  it('reveals four tiles around friendly boats and follows their movement without revealing rival vessels', () => {
    const { state, boat } = fixture();
    beginFogFrame(state);
    try {
      const fog = updateFog(state);
      expect(fog.sources).toEqual([{ x: 32.5, y: 20.5, radius: 4 }]);
      expect(pointInSight(fog, 34.5, 20.5)).toBe(true);
      expect(pointInSight(fog, 8.5, 20.5)).toBe(false);
      boat.x = 26.5; invalidateFog(state);
      const moved = updateFog(state);
      expect(pointInSight(moved, 26.5, 20.5)).toBe(true);
      expect(pointInSight(moved, 34.5, 20.5)).toBe(false);
    } finally { endFogFrame(state); }
  });

  it('draws only observed fish and vessels beneath fog, without zone indicators', () => {
    const { state } = fixture(), frame = recordNativeFrame(state);
    const fish = frame.drawOrder.filter(key => key.startsWith('fish:'));
    const boats = frame.drawOrder.filter(key => key.startsWith('fishing-boat:'));
    expect(fish).toHaveLength(1); expect(boats).toHaveLength(1);
    expect(frame.drawOrder.indexOf(fish[0])).toBeLessThan(frame.drawOrder.indexOf('fog'));
    expect(frame.drawOrder.indexOf(boats[0])).toBeLessThan(frame.drawOrder.indexOf('fog'));
    expect(frame.drawOrder.some(key => key.includes('fishing-zone'))).toBe(false);
  });

  it('submerged fish add no geometry even in observed water', () => {
    const { state } = fixture();
    for (const fish of state.fishing!.fish) setSurfaceFrame(fish, state.time, -1);
    const frame = recordNativeFrame(state);
    expect(frame.drawOrder.some(key => key.startsWith('fish:'))).toBe(false);
    expect(frame.drawOrder.filter(key => key.startsWith('fishing-boat:'))).toHaveLength(1);
    expect(frame.drawOrder.some(key => key.includes('fishing-zone'))).toBe(false);
  });
});
