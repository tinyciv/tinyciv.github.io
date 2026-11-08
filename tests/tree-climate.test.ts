import { describe, expect, it } from 'vitest';
import { assignTreeClimate, climateTreeClass, treeClimateLatitude } from '../src/world/tree-climate';
import { generateWorld } from '../src/world/generator';
import type { Tile, World } from '../src/game/types';
import { resolveLandscapeParameters } from '../src/world/options';

const tree = (changes: Partial<Tile> = {}): Tile => ({ terrain: 'grassland', overlay: 'forest', elevation: .3, moisture: .7,
  food: 1, production: 2, gold: 0, variation: .5, ...changes });

describe('latitude-based tree families', () => {
  it('places tropical trees near the equator, broadleaf at middle latitudes, and evergreens near poles (snow is reserved for tundra)', () => {
    expect(climateTreeClass(0, tree())).toBe('tropical');
    expect(climateTreeClass(.4, tree())).toBe('temperate');
    expect(climateTreeClass(.65, tree())).toBe('conifer');
    expect(climateTreeClass(.9, tree())).toBe('conifer');
    expect(climateTreeClass(.4, tree({ moisture: .2 }))).toBe('dry');
    expect(climateTreeClass(.75, tree({ elevation: .9 }))).toBe('conifer');
  });

  it('assigns a cool north and a warm shifted equator while keeping palms out of cold latitudes', () => {
    const parameters = resolveLandscapeParameters({ equatorPosition: .65, equatorWidth: .3 });
    const world: World = { width: 12, height: 101, seed: 'tree-bands', source: 'test', spawns: [],
      tiles: Array.from({ length: 1212 }, () => tree()) };
    for (const y of [2, 65, 98]) Object.assign(world.tiles[y * 12], { overlay: 'none', palm: true, beach: true, terrain: 'desert' });
    assignTreeClimate(world, parameters);
    expect(world.tiles[2 * 12].palm).toBeUndefined();
    expect(world.tiles[98 * 12].palm).toBeUndefined();
    expect(world.tiles[65 * 12]).toMatchObject({ palm: true, treeClass: 'tropical' });
    expect(world.tiles[5 * 12 + 4].treeClass).toBe('conifer');
    expect(world.tiles[25 * 12 + 4].treeClass).toBe('conifer');
    for (const y of [40, 90]) expect(world.tiles[y * 12 + 4].treeClass).toBe('temperate');
    expect(world.tiles[65 * 12 + 4].treeClass).toBe('tropical');
    const before = JSON.stringify(world); assignTreeClimate(world, parameters); expect(JSON.stringify(world)).toBe(before);
  });

  it('moves species bands with the equator parameter', () => {
    const world: World = { width: 12, height: 101, seed: 'moving-equator', source: 'test', spawns: [],
      tiles: Array.from({ length: 1212 }, () => tree()) };
    assignTreeClimate(world, resolveLandscapeParameters({ equatorPosition: .45, equatorWidth: .3 }));
    expect(world.tiles[75 * 12 + 4].treeClass).toBe('temperate');
    assignTreeClimate(world, resolveLandscapeParameters({ equatorPosition: .8, equatorWidth: .3 }));
    expect(world.tiles[75 * 12 + 4].treeClass).toBe('tropical');
    expect(world.tiles[5 * 12 + 4].treeClass).toBe('conifer');
  });

  it('persists classified trees on generated mainland and offshore islands without changing terrain rules', () => {
    const world = generateWorld('medieval-forest-climates', 96, 80), classes = new Set<string>();
    for (let i = 0; i < world.tiles.length; i++) {
      const tile = world.tiles[i];
      if (tile.overlay === 'forest' || tile.overlay === 'jungle' || tile.palm) {
        expect(tile.treeClass).toBeDefined(); classes.add(tile.treeClass!);
      } else expect(tile.treeClass).toBeUndefined();
      if (tile.palm) expect(treeClimateLatitude(Math.floor(i / world.width), world.height)).toBeLessThanOrEqual(.43);
    }
    expect(classes.has('temperate')).toBe(true);
    expect(classes.has('conifer')).toBe(true);
    expect(classes.has('tropical')).toBe(true);
  });
});
