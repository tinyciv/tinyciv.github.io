import { describe, expect, it } from 'vitest';
import { ridgeEdgeAllowed, ridgeGroundWalkable, ridgeLevel } from '../src/game/ridges';
import { WATER, type World } from '../src/game/types';
import { generateWorld } from '../src/world/generator';
import { addWaterfallTributaries, isSouthWaterfallLip, markRiverWaterfalls } from '../src/world/waterfalls';

function shelves(): World {
  const width = 25, height = 25;
  const world: World = { width, height, seed: 'waterfall-shelves', source: 'fixture', spawns: [],
    tiles: Array.from({ length: width * height }, (_, cell) => {
      const x = cell % width, y = Math.floor(cell / width), tier = x >= 6 && x <= 18 && y >= 4 && y <= 10 ? 2
        : x >= 3 && x <= 21 && y >= 2 && y <= 18 ? 1 : 0;
      return { terrain: y >= 23 ? 'river' : 'grassland', overlay: 'none',
        elevation: .5 - y * .004 + tier * .2, moisture: .7, rainfall: .7,
        food: 3, production: 1, gold: 0, variation: .5, flow: 10, drainage: y < height - 1 ? cell + width : -1,
        ...(tier ? { ridge: 1, ridgeTier: tier, relief: 'hills' } : {}) };
    }) };
  for (const [x, y, stair] of [[3,14,'east'],[21,14,'west'],[6,7,'east'],[18,7,'west']] as const)
    world.tiles[y * width + x].stair = stair;
  return world;
}

function reachable(world: World): Set<number> {
  const { tiles, width, height } = world, queue = tiles.flatMap((tile, cell) => !tile.ridge && !WATER.has(tile.terrain) ? [cell] : []), seen = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
    for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen.has(next) || WATER.has(tiles[next].terrain)
        || !ridgeGroundWalkable(world, nx, ny) || !ridgeEdgeAllowed(world, { x, y }, { x: nx, y: ny })) continue;
      seen.add(next); queue.push(next);
    }
  }
  return seen;
}

function checkFalls(world: World): number[] {
  const { tiles, width } = world, falls = tiles.flatMap((tile, cell) => tile.waterfall ? [cell] : []);
  for (const cell of falls) {
    expect(isSouthWaterfallLip(world, cell)).toBe(true);
    expect(tiles[cell].terrain).toBe('river'); expect(tiles[cell].riverArt).toBe('banked');
    expect(tiles[cell].channelNext).toBe(cell + width);
    expect(tiles[cell - width].channelNext).toBe(cell);
    expect(ridgeLevel(tiles[cell])).toBe(ridgeLevel(tiles[cell + width]) + 1);
    expect(tiles[cell - width].elevation).toBeGreaterThanOrEqual(tiles[cell].elevation);
    expect(tiles[cell].elevation).toBeGreaterThanOrEqual(tiles[cell + width].elevation);
    expect(tiles[cell].overlay).toBe('none'); expect(tiles[cell].fordAxis).toBeUndefined();
    expect(tiles[cell].stair).toBeUndefined();
  }
  return falls;
}

describe('rivers descending native ledges', () => {
  it('recognizes a genuine two-tier cascade and removes stale fords at both drops', () => {
    const world = shelves();
    for (let y = 6; y <= 23; y++) Object.assign(world.tiles[y * world.width + 12], {
      terrain: 'river', channel: 'tributary', channelWidth: 1, creek: true,
      channelNext: (y + 1) * world.width + 12, overlay: 'ford', fordAxis: 'horizontal',
    });
    const falls = markRiverWaterfalls(world);
    expect(falls).toEqual([10 * world.width + 12, 18 * world.width + 12]);
    expect(checkFalls(world)).toEqual(falls);
    const unchanged = structuredClone(world); expect(markRiverWaterfalls(world)).toEqual(falls); expect(world).toEqual(unchanged);
  });

  it('rejects uphill flow, sideways exits and missing downstream water', () => {
    for (const mode of ['uphill', 'sideways', 'dry-foot'] as const) {
      const world = shelves(), lip = 18 * world.width + 12;
      for (let y = 16; y <= 20; y++) Object.assign(world.tiles[y * world.width + 12], {
        terrain: 'river', channel: 'tributary', channelWidth: 1, channelNext: (y + 1) * world.width + 12,
      });
      if (mode === 'uphill') world.tiles[lip + world.width].elevation = world.tiles[lip].elevation + .1;
      if (mode === 'sideways') world.tiles[lip].channelNext = lip + 1;
      if (mode === 'dry-foot') world.tiles[lip + world.width].terrain = 'grassland';
      expect(markRiverWaterfalls(world)).toEqual([]);
    }
  });

  it('adds connected downhill headwaters without changing cliffs, stairs or accessible terrace banks', () => {
    const world = shelves(), before = reachable(world), geometry = world.tiles.map(t => [t.ridge, t.ridgeTier, t.stair]);
    const result = addWaterfallTributaries(world);
    expect(result.paths.length).toBeGreaterThan(0); expect(checkFalls(world).length).toBeGreaterThan(0);
    expect(world.tiles.map(t => [t.ridge, t.ridgeTier, t.stair])).toEqual(geometry);
    const after = reachable(world);
    for (const cell of before) if (world.tiles[cell].ridge && !WATER.has(world.tiles[cell].terrain)) expect(after.has(cell)).toBe(true);
    for (const path of result.paths) {
      expect(path.length).toBeGreaterThan(4);
      for (let i = 0; i < path.length - 1; i++) {
        const tile = world.tiles[path[i]], next = world.tiles[path[i + 1]];
        expect(tile.terrain).toBe('river'); expect(tile.channelNext).toBe(path[i + 1]); expect(tile.drainage).toBe(path[i + 1]);
        expect(tile.elevation).toBeGreaterThanOrEqual(next.elevation); expect(ridgeLevel(tile)).toBeGreaterThanOrEqual(ridgeLevel(next));
      }
      expect(WATER.has(world.tiles[path.at(-1)!].terrain)).toBe(true);
    }
    const repeat = shelves(); expect(addWaterfallTributaries(repeat)).toEqual(result); expect(repeat).toEqual(world);
  });

  it('produces legal waterfalls in a real procedural world while retaining an acyclic runoff graph', () => {
    const world = generateWorld('CROWN'), { tiles, width } = world;
    expect(checkFalls(world).length).toBeGreaterThan(0);
    const incoming = new Uint16Array(tiles.length);
    for (const tile of tiles) if ((tile.drainage ?? -1) >= 0) incoming[tile.drainage!]++;
    const order = tiles.flatMap((_, cell) => incoming[cell] ? [] : [cell]);
    for (let head = 0; head < order.length; head++) {
      const cell = order[head], tile = tiles[cell], next = tile.drainage ?? -1;
      if (next >= 0) {
        expect(tile.elevation + 1e-9).toBeGreaterThanOrEqual(tiles[next].elevation);
        if (tile.channel) { expect(tile.channelNext).toBe(next); expect(WATER.has(tiles[next].terrain)).toBe(true); }
        if (!--incoming[next]) order.push(next);
      }
    }
    expect(order).toHaveLength(tiles.length);
    const accessible = reachable(world);
    for (const [cell, tile] of tiles.entries()) if (tile.ridge && !WATER.has(tile.terrain) && ridgeGroundWalkable(world, cell % width, Math.floor(cell / width)))
      expect(accessible.has(cell), `terrace bank ${cell % width},${Math.floor(cell / width)}`).toBe(true);
  }, 20000);

  it('recognizes existing geographic rivers on Mediterranean shelves, including upper-tier drops', () => {
    const world = generateWorld('MED-200BC', undefined, undefined, { style: 'mediterranean' });
    const falls = checkFalls(world); expect(falls.length).toBeGreaterThan(0);
    expect(falls.some(cell => ridgeLevel(world.tiles[cell]) > 1)).toBe(true);
  }, 20000);
});
