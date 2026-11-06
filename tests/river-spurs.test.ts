import { describe, expect, it } from 'vitest';
import { WATER, type Tile, type World } from '../src/game/types';
import { generateMediterraneanWorld } from '../src/world/mediterranean';
import { pruneShortRiverSpurs } from '../src/world/river-spurs';

function fixture() {
  const width = 20, height = 16;
  const world: World = { width, height, seed: 'river-spurs', source: 'test', spawns: [],
    tiles: Array.from({ length: width * height }, (_, cell) => ({ terrain: 'grassland', overlay: 'none',
      elevation: .4, moisture: .31, food: 3, production: 2, gold: 1, variation: cell / (width * height) })) };
  const original = new Map<number, Tile>();
  const index = (x: number, y: number) => y * width + x;
  const river = (x: number, y: number, main = false) => {
    const cell = index(x, y);
    if (!original.has(cell)) original.set(cell, { ...world.tiles[cell] });
    Object.assign(world.tiles[cell], { terrain: 'river', moisture: 1, food: 1, production: 0, gold: 0,
      creek: !main, channel: main ? 'main' : 'tributary', channelWidth: main ? 1 : .25 });
    return cell;
  };
  return { world, original, river, index };
}

function waterNeighbors(world: World, cell: number): number[] {
  const x = cell % world.width, y = Math.floor(cell / world.width);
  return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
    .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < world.width && ny < world.height)
    .map(([nx, ny]) => ny * world.width + nx).filter(next => WATER.has(world.tiles[next].terrain));
}

describe('short river side branches', () => {
  it.each([false, true])('removes one- and two-cell side spurs without changing the main channel (broad: %s)', main => {
    const { world, original, river, index } = fixture();
    const trunk = Array.from({ length: 16 }, (_, x) => river(x + 2, 8, main));
    const spurs = [river(7, 7, main), river(12, 7, main), river(12, 6, main)];
    const retained = trunk.map(cell => ({ ...world.tiles[cell] }));
    expect(pruneShortRiverSpurs(world, original)).toEqual([...spurs].sort((a, b) => a - b));
    expect(trunk.map(cell => world.tiles[cell])).toEqual(retained);
    for (const cell of spurs) expect(world.tiles[cell]).toEqual(original.get(cell));
    expect(world.tiles[index(12, 6)]).not.toHaveProperty('creek');
    expect(world.tiles[index(12, 6)].moisture).toBe(.31);
  });

  it('retains longer tributaries and unbranched headwaters without trimming their tips', () => {
    const { world, original, river } = fixture();
    for (let x = 2; x <= 17; x++) river(x, 8);
    for (let y = 5; y <= 7; y++) river(7, y);
    for (let y = 9; y <= 14; y++) river(13, y);
    river(2, 2); river(3, 2); // A short separate stream has no junction or side spur.
    const before = structuredClone(world.tiles);
    expect(pruneShortRiverSpurs(world, original)).toEqual([]);
    expect(world.tiles).toEqual(before);
  });

  it('retains a source arm at a tiny headwater fork instead of recursively peeling the river', () => {
    const { world, original, river, index } = fixture();
    for (let x = 2; x <= 17; x++) river(x, 10);
    river(10, 9); river(10, 8);
    const lowerArm = river(9, 8), higherArm = river(10, 7);
    world.tiles[higherArm].elevation = .8;
    expect(pruneShortRiverSpurs(world, original)).toEqual([lowerArm]);
    for (const cell of [higherArm, index(10, 8), index(10, 9), index(10, 10)])
      expect(world.tiles[cell].terrain).toBe('river');
    expect(waterNeighbors(world, index(10, 8))).toHaveLength(2);
    expect(pruneShortRiverSpurs(world, original)).toEqual([]);
  });

  it('preserves sea/lake outlets and short connections to the edge of the map', () => {
    const { world, original, river, index } = fixture();
    for (let y = 2; y <= 13; y++) river(2, y, true);
    river(1, 8); river(0, 8);
    for (let x = 3; x <= 17; x++) river(x, 8);
    river(7, 9); river(7, 10); world.tiles[index(7, 11)].terrain = 'ocean';
    river(13, 7); river(13, 6); world.tiles[index(13, 5)].terrain = 'lake';
    for (let x = 5; x <= 17; x++) river(x, 0);
    river(10, 1); // Its junction is itself a clipped map-edge river.
    const before = structuredClone(world.tiles);
    expect(pruneShortRiverSpurs(world, original)).toEqual([]);
    expect(world.tiles).toEqual(before);
  });

  it('generates no interior one- or two-cell terminal spurs and keeps all downstream links valid', () => {
    const world = generateMediterraneanWorld('MED-200BC');
    const boundary = (cell: number) => cell % world.width === 0 || cell % world.width === world.width - 1
      || cell < world.width || cell >= world.tiles.length - world.width;
    const spurs: number[][] = [];
    world.tiles.forEach((tile, start) => {
      if (tile.terrain !== 'river') return;
      const next = tile.channelNext;
      expect(next).toBeDefined();
      if (next! >= 0) {
        expect(waterNeighbors(world, start)).toContain(next);
        expect(WATER.has(world.tiles[next!].terrain)).toBe(true);
      }
      if (waterNeighbors(world, start).length !== 1) return;
      const path: number[] = []; let previous = -1, cell = start;
      while (path.length <= 2 && world.tiles[cell].terrain === 'river' && !boundary(cell)) {
        const adjacent = waterNeighbors(world, cell);
        if (adjacent.length >= 3) { spurs.push(path); break; }
        if (adjacent.length !== (previous < 0 ? 1 : 2)) break;
        path.push(cell); const nextCell = adjacent.find(next => next !== previous)!;
        previous = cell; cell = nextCell;
      }
    });
    expect(spurs).toEqual([]);
    const finished = new Set<number>();
    world.tiles.forEach((tile, start) => {
      if (tile.terrain !== 'river') return;
      const path = new Set<number>(); let cell = start;
      while (cell >= 0 && world.tiles[cell].terrain === 'river' && !finished.has(cell)) {
        expect(path.has(cell), `acyclic flow at ${cell}`).toBe(false);
        path.add(cell); cell = world.tiles[cell].channelNext!;
      }
      for (const visited of path) finished.add(visited);
    });
  }, 20000);
});
