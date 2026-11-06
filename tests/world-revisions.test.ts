import { describe, expect, it } from 'vitest';
import { markWorldChanged, worldRevisions } from '../src/game/world-revisions';
import type { World } from '../src/game/types';

const fixture = (): World => ({ width: 2, height: 2, seed: 'semantic-world', source: 'test', revision: 0, spawns: [],
  tiles: Array.from({ length: 4 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
    moisture: .5, food: 1, production: 1, gold: 0, variation: .5 })) });

describe('semantic world revisions', () => {
  it('keeps terrain and sight stable across structural edits while preserving the raw navigation revision', () => {
    const world = fixture(), before = worldRevisions(world);
    for (let i = 0; i < 20; i++) markWorldChanged(world);
    expect(world.revision).toBe(20);
    expect(worldRevisions(world)).toEqual(before);
    markWorldChanged(world, 'appearance');
    expect(worldRevisions(world)).toEqual({ appearance: 1, sight: 0, geometry: 0 });
    markWorldChanged(world, 'sight');
    expect(worldRevisions(world)).toEqual({ appearance: 2, sight: 1, geometry: 0 });
    markWorldChanged(world, 'geometry');
    expect(worldRevisions(world)).toEqual({ appearance: 3, sight: 2, geometry: 1 });
  });

  it('does not hide unknown raw edits when a known structural edit follows before a reader', () => {
    const world = fixture(); worldRevisions(world);
    world.tiles[0].overlay = 'forest'; world.revision!++;
    markWorldChanged(world);
    expect(worldRevisions(world)).toEqual({ appearance: 1, sight: 1, geometry: 1 });
    expect(worldRevisions(world)).toEqual({ appearance: 1, sight: 1, geometry: 1 });
    world.revision = 0;
    expect(worldRevisions(world)).toEqual({ appearance: 2, sight: 2, geometry: 2 });
  });

  it('invalidates replacement tile data even with an unchanged raw revision', () => {
    const world = fixture(); worldRevisions(world);
    world.tiles = world.tiles.map(tile => ({ ...tile, terrain: 'lake' }));
    expect(worldRevisions(world)).toEqual({ appearance: 1, sight: 1, geometry: 1 });
  });

  it('keeps unversioned reads stable and detects direct changes before normalizing on a known edit', () => {
    const world = fixture(); delete world.revision;
    const first = worldRevisions(world);
    expect(worldRevisions(world)).toBe(first);
    world.tiles[0].ridge = 1;
    const changed = worldRevisions(world);
    expect(changed).toEqual({ appearance: 1, sight: 1, geometry: 1 });
    expect(worldRevisions(world)).toBe(changed);
    markWorldChanged(world);
    expect(world.revision).toBe(1);
    expect(worldRevisions(world)).toEqual(changed);
  });
});
