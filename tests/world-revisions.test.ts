import { describe, expect, it } from 'vitest';
import { markWorldChanged, recordWorldTileChanges, worldChangesSince, worldRevisions } from '../src/game/world-revisions';
import type { World } from '../src/game/types';

const fixture = (): World => ({ width: 2, height: 2, seed: 'semantic-world', source: 'test', revision: 0, spawns: [],
  tiles: Array.from({ length: 4 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
    moisture: .5, food: 1, production: 1, gold: 0, variation: .5 })) });

describe('semantic world revisions', () => {
  it('lets independent consumers read deduplicated tile edits without structural false positives', () => {
    const world = fixture(), start = worldChangesSince(world);
    expect(start.full).toBe(true);
    markWorldChanged(world);
    expect(worldChangesSince(world, start.revision)).toEqual({ revision: start.revision, full: false, cells: [] });
    world.tiles[1].overlay = 'forest'; markWorldChanged(world, 'sight', [1, 1]);
    const fast = worldChangesSince(world, start.revision);
    expect(fast.full).toBe(false); expect(fast.cells).toEqual([1]);
    world.tiles[2].farm = 0; markWorldChanged(world, 'appearance', [2]);
    expect(worldChangesSince(world, fast.revision).cells).toEqual([2]);
    expect([...worldChangesSince(world, start.revision).cells].sort()).toEqual([1, 2]);
    const raw = world.revision;
    recordWorldTileChanges(world, [3]);
    expect(world.revision).toBe(raw);
    expect([...worldChangesSince(world, fast.revision).cells].sort()).toEqual([2, 3]);
  });

  it('falls back to complete data for unknown edits, rewinds, replacements and expired cursors', () => {
    const world = fixture(), cursor = worldChangesSince(world).revision;
    world.revision!++;
    expect(worldChangesSince(world, cursor).full).toBe(true);
    let next = worldChangesSince(world).revision;
    world.tiles = world.tiles.map(tile => ({ ...tile }));
    expect(worldChangesSince(world, next).full).toBe(true);
    next = worldChangesSince(world).revision;
    world.revision = -1;
    expect(worldChangesSince(world, next).full).toBe(true);
    next = worldChangesSince(world).revision;
    for (let i = 0; i < 1100; i++) markWorldChanged(world, 'appearance', [i % 4]);
    expect(worldChangesSince(world, next).full).toBe(true);
    const fresh = worldChangesSince(world).revision;
    expect(worldChangesSince(world, fresh)).toEqual({ revision: fresh, full: false, cells: [] });
    expect(worldChangesSince(world, fresh + 1).full).toBe(true);
  });

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
