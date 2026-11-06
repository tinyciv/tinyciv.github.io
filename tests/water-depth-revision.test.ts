import { describe, expect, it } from 'vitest';
import { prepareWaterDepth, waterDepthAt, waterDepthField } from '../src/game/water-depth';
import { markWorldChanged } from '../src/game/world-revisions';
import type { Terrain, World } from '../src/game/types';

function fixture(): { world: World; reads: () => number; reset: () => void } {
  let reads = 0;
  const world: World = { width: 32, height: 16, revision: 0, seed: 'water-revisions', source: 'test', spawns: [],
    tiles: Array.from({ length: 512 }, (_, i) => {
      let terrain: Terrain = i % 32 === 0 ? 'grassland' : 'ocean';
      return { get terrain() { reads++; return terrain; }, set terrain(value: Terrain) { terrain = value; },
        overlay: 'none', elevation: .3, moisture: .5, food: 0, production: 0, gold: 0, variation: .5 };
    }) };
  return { world, reads: () => reads, reset: () => { reads = 0; } };
}

describe('water depth revision dependencies', () => {
  it('does not rescan terrain for roads, farm paint, woodland clearing, or repeated water samples', () => {
    const { world, reads, reset } = fixture(), field = prepareWaterDepth(world);
    reset();
    for (const kind of ['structure', 'appearance', 'sight'] as const) {
      markWorldChanged(world, kind);
      for (let i = 0; i < 100; i++) {
        expect(waterDepthField(world)).toBe(field);
        expect(waterDepthAt(world, 20, 8)).toBe(field.distance[8 * 32 + 20]);
      }
    }
    expect(reads()).toBe(0);
  });

  it.each(['classified', 'raw'] as const)('rebuilds distances after a %s coastline edit', mode => {
    const { world, reads, reset } = fixture(), field = prepareWaterDepth(world), target = 8 * 32 + 20;
    expect(field.bands[target]).toBe(2);
    world.tiles[target].terrain = 'grassland';
    if (mode === 'classified') markWorldChanged(world, 'geometry');
    else world.revision!++;
    reset();
    const changed = waterDepthField(world);
    expect(changed).not.toBe(field);
    expect(changed.distance[target]).toBe(0);
    expect(changed.bands[target + 1]).toBe(0);
    expect(reads()).toBeGreaterThanOrEqual(world.tiles.length);
  });

  it('keeps explicit preparation sensitive to edits without a revision bump', () => {
    const { world } = fixture(), field = prepareWaterDepth(world), target = 8 * 32 + 20;
    world.tiles[target].terrain = 'grassland';
    const changed = prepareWaterDepth(world);
    expect(changed).not.toBe(field);
    expect(changed.distance[target]).toBe(0);
    expect(waterDepthField(world)).toBe(changed);
  });

  it('does not fingerprint an unversioned fixture once for every sampled tile', () => {
    const { world, reads, reset } = fixture(); delete world.revision;
    const field = prepareWaterDepth(world); reset();
    for (let i = 0; i < world.tiles.length; i++) expect(waterDepthField(world)).toBe(field);
    expect(reads()).toBe(0);
  });
});
