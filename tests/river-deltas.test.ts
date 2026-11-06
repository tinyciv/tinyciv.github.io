import { describe, expect, it } from 'vitest';
import { WATER, type World } from '../src/game/types';
import { generateRiverDeltas } from '../src/world/river-deltas';

function coast(seed = 'DELTA-FIXTURE-0', rotation = 0): World {
  const width = 128, height = 128;
  const at = (x: number, y: number) => {
    for (let turn = 0; turn < rotation; turn++) [x, y] = [width - 1 - y, x];
    return y * width + x;
  };
  const world: World = { width, height, seed, source: 'test', spawns: [], tiles: new Array(width * height) };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ocean = x >= 80, river = !ocean && y === 64 && x >= 20;
    world.tiles[at(x, y)] = { terrain: ocean ? x < 82 ? 'coast' : 'ocean' : river ? 'river' : 'grassland', overlay: 'none',
      elevation: ocean ? 0 : .035 + (80 - x) * .001, moisture: .7, rainfall: .7, variation: .5,
      food: 3, production: 1, gold: 0, drainage: ocean ? -1 : at(x + 1, y), flow: river ? 500 : 1,
      ...(river ? { channel: 'main', channelWidth: 3, channelNext: at(x + 1, y) } : {}) };
  }
  return world;
}

function graphAudit(world: World): void {
  const { tiles, width } = world, incoming = new Uint8Array(tiles.length);
  const flow = Float64Array.from(tiles, tile => ['ocean', 'coast'].includes(tile.terrain) ? 0 : .15 + (tile.rainfall ?? tile.moisture) * .85);
  for (const tile of tiles) if ((tile.drainage ?? -1) >= 0) incoming[tile.drainage!]++;
  const queue = tiles.flatMap((_, cell) => incoming[cell] ? [] : [cell]);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], tile = tiles[cell], next = tile.drainage ?? -1;
    expect(tile.flow).toBeCloseTo(flow[cell], 8);
    if (next < 0) { expect(['coast', 'ocean']).toContain(tile.terrain); continue; }
    expect(Math.abs(next % width - cell % width) + Math.abs(Math.floor(next / width) - Math.floor(cell / width))).toBe(1);
    expect(tile.elevation + 1e-9).toBeGreaterThanOrEqual(tiles[next].elevation);
    if (tile.terrain === 'river') expect(WATER.has(tiles[next].terrain)).toBe(true);
    if (tile.channel) expect(tile.channelNext).toBe(next);
    flow[next] += flow[cell]; if (!--incoming[next]) queue.push(next);
  }
  expect(queue).toHaveLength(tiles.length);
}

describe('coastal river delta marshes', () => {
  it('creates repeatable speckled fans with real ocean branches while retaining the feeder river', () => {
    const world = coast(), before = structuredClone(world), deltas = generateRiverDeltas(world);
    expect(deltas).toHaveLength(1);
    const delta = deltas[0];
    expect(delta.cells.length).toBeGreaterThan(250);
    expect(delta.marshCells.length).toBeGreaterThan(100);
    expect(delta.waterFraction).toBeGreaterThan(.35);
    expect(delta.waterFraction).toBeLessThan(.7);
    expect(delta.distributaries.length).toBeGreaterThanOrEqual(2);
    for (const path of delta.distributaries) {
      expect(path[0]).toBe(delta.mouth);
      expect(path.every(cell => WATER.has(world.tiles[cell].terrain))).toBe(true);
      for (let n = 1; n < path.length; n++) expect(Math.abs(path[n] % world.width - path[n - 1] % world.width)
        + Math.abs(Math.floor(path[n] / world.width) - Math.floor(path[n - 1] / world.width))).toBe(1);
    }
    for (const cell of delta.marshCells) {
      expect(world.tiles[cell].marsh).toBe(true); expect(world.tiles[cell].terrain).toBe('grassland');
      expect(world.tiles[cell].biome).toBe('wetland'); expect(world.tiles[cell].overlay).toBe('none');
      const x = cell % world.width, y = Math.floor(cell / world.width);
      if (x + 1 < world.width && y + 1 < world.height)
        expect([cell, cell + 1, cell + world.width, cell + world.width + 1].every(next => world.tiles[next].marsh)).toBe(false);
    }
    for (const [cell, tile] of before.tiles.entries()) if (tile.channel) {
      expect(world.tiles[cell].channelNext).toBe(tile.channelNext);
      expect(world.tiles[cell].terrain).toBe('river');
      expect(WATER.has(world.tiles[tile.channelNext!].terrain)).toBe(true);
    }
    graphAudit(world);
    const again = coast(); expect(generateRiverDeltas(again)).toEqual(deltas); expect(again).toEqual(world);
  });

  it('respects all four ocean directions and retains downstream runoff accounting', () => {
    let produced = 0;
    for (let rotation = 0; rotation < 4; rotation++) {
      const world = coast('DELTA-FIXTURE-0', rotation), deltas = generateRiverDeltas(world);
      if (!deltas.length) continue;
      produced++; graphAudit(world);
      const axis = deltas[0].direction, expected = [[1, 0], [0, 1], [-1, 0], [0, -1]][rotation];
      expect(axis.x * expected[0] + axis.y * expected[1]).toBeGreaterThan(.8);
    }
    expect(produced).toBe(4);
  });

  it('does not turn tiny rivers, lake outlets, or steep confined mouths into deltas', () => {
    for (const kind of ['small', 'lake', 'steep'] as const) {
      const world = coast();
      for (const tile of world.tiles) {
        if (kind === 'small' && tile.channel) tile.flow = 20;
        if (kind === 'lake' && ['coast', 'ocean'].includes(tile.terrain)) tile.terrain = 'lake';
        if (kind === 'steep' && !WATER.has(tile.terrain)) { tile.elevation = .8; tile.relief = 'mountains'; }
      }
      const before = structuredClone(world);
      expect(generateRiverDeltas(world)).toEqual([]); expect(world).toEqual(before);
    }
  });

  it('leaves ledges and their complete two-tile access aprons untouched', () => {
    const world = coast();
    for (let y = 51; y < 55; y++) for (let x = 74; x < 78; x++) Object.assign(world.tiles[y * 128 + x], { ridge: 1, relief: 'hills', ridgeTier: 1 });
    const before = structuredClone(world); expect(generateRiverDeltas(world)).toHaveLength(1);
    for (let y = 49; y < 57; y++) for (let x = 72; x < 80; x++) {
      const cell = y * 128 + x;
      expect(world.tiles[cell].terrain).toBe(before.tiles[cell].terrain);
      expect(world.tiles[cell].delta).toBeUndefined();
      expect(world.tiles[cell].ridge).toBe(before.tiles[cell].ridge);
    }
  });
});
