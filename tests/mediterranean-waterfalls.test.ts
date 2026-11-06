import { describe, expect, it, vi } from 'vitest';
import { generateWorld } from '../src/world/generator';
import * as waterfalls from '../src/world/waterfalls';
import { ridgeLevel } from '../src/game/ridges';
import { WATER, type Tile, type World } from '../src/game/types';

function withoutAlpineTributaries(): World {
  const original = waterfalls.addWaterfallTributaries;
  const stub = vi.spyOn(waterfalls, 'addWaterfallTributaries').mockImplementation((world, options) =>
    options?.geographic ? { paths: [], falls: [] } : original(world, options));
  try { return generateWorld('MED-200BC', undefined, undefined, { style: 'mediterranean' }); }
  finally { stub.mockRestore(); }
}

const geometry = (tile: Tile) => [tile.ridge, tile.ridgeTier, tile.stair, tile.elevation];
const river = (tile: Tile) => [tile.terrain, tile.channel, tile.channelNext, tile.drainage, tile.creek, tile.riverArt];
const appearance = (tile: Tile) => [tile.terrain, tile.overlay, tile.treeClass, tile.palm, tile.marsh, tile.riverArt, tile.waterfall];

describe('Alpine waterfall headwaters', () => {
  it('adds complete downhill Alpine tributaries while retaining mapped rivers, mountain geometry and distant vegetation', () => {
    const before = withoutAlpineTributaries();
    const world = generateWorld('MED-200BC', undefined, undefined, { style: 'mediterranean' });
    expect(world.spawns).toEqual(before.spawns); expect(world.secondarySpawns).toEqual(before.secondarySpawns);
    expect(world.tiles.map(geometry)).toEqual(before.tiles.map(geometry));
    const added = new Set(world.tiles.flatMap((tile, cell) => tile.terrain === 'river' && !WATER.has(before.tiles[cell].terrain) ? [cell] : []));
    expect(added.size).toBeGreaterThan(20);
    const incoming = new Set<number>();
    for (const cell of added) {
      const tile = world.tiles[cell], next = tile.channelNext!;
      expect(next).toBeGreaterThanOrEqual(0);
      expect(WATER.has(world.tiles[next].terrain)).toBe(true);
      expect(tile.elevation).toBeGreaterThanOrEqual(world.tiles[next].elevation);
      expect(ridgeLevel(tile)).toBeGreaterThanOrEqual(ridgeLevel(world.tiles[next]));
      expect(Math.abs(cell % world.width - next % world.width) + Math.abs(Math.floor(cell / world.width) - Math.floor(next / world.width))).toBe(1);
      if (added.has(next)) incoming.add(next);
    }
    const sources = [...added].filter(cell => !incoming.has(cell));
    expect(sources.length).toBeGreaterThanOrEqual(4);
    for (const source of sources) {
      const path: number[] = []; let cell = source;
      while (added.has(cell)) {
        expect(path).not.toContain(cell); path.push(cell); cell = world.tiles[cell].channelNext!;
      }
      expect(path.length).toBeGreaterThanOrEqual(4);
      expect(path.some(cell => world.tiles[cell].waterfall)).toBe(true);
      expect(WATER.has(before.tiles[cell].terrain)).toBe(true);
    }
    const falls = [...added].filter(cell => world.tiles[cell].waterfall);
    expect(falls.length).toBeGreaterThanOrEqual(4);
    for (const cell of falls) {
      expect(waterfalls.isSouthWaterfallLip(world, cell)).toBe(true);
      expect(world.tiles[cell].channelNext).toBe(cell + world.width);
      expect(world.tiles[cell - world.width].channelNext).toBe(cell);
      expect(world.tiles[cell].overlay).toBe('none');
      expect(world.tiles[cell].fordAxis).toBeUndefined();
    }
    world.tiles.forEach((tile, cell) => {
      if (WATER.has(before.tiles[cell].terrain)) expect(river(tile), `mapped channel ${cell}`).toEqual(river(before.tiles[cell]));
      const lon = -12 + (cell % world.width + .5) / world.width * 54;
      const lat = 49 - (Math.floor(cell / world.width) + .5) / world.height * 22;
      if (lon < 4 || lon > 17.5 || lat < 43) expect(appearance(tile), `unchanged distant tile ${cell}`).toEqual(appearance(before.tiles[cell]));
    });
  }, 20000);
});
