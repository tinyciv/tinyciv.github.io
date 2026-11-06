import { describe, expect, it } from 'vitest';
import { addRiverFords, generateWorld } from '../src/world/generator';
import { fordCrossingAxis } from '../src/game/ford-art';
import { WATER, type World } from '../src/game/types';
import { canTraverseEdge, traversable } from '../src/game/pathfinding';
import chosenLandscape from './fixtures/fractal-gallery-20.json';

function fordGroups(world: World): number[][] {
  const seen = new Set<number>(), groups: number[][] = [];
  for (let i = 0; i < world.tiles.length; i++) {
    if (seen.has(i) || world.tiles[i].overlay !== 'ford') continue;
    const group = [i]; seen.add(i);
    for (let head = 0; head < group.length; head++) {
      const cell = group[head], x = cell % world.width, y = Math.floor(cell / world.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || seen.has(next) || world.tiles[next].overlay !== 'ford') continue;
        seen.add(next); group.push(next);
      }
    }
    groups.push(group);
  }
  return groups;
}

function checkCrossings(world: World): Set<number> {
  const widths = new Set<number>();
  for (const group of fordGroups(world)) {
    const axis = world.tiles[group[0]].fordAxis!;
    expect(['horizontal', 'vertical']).toContain(axis);
    const lanes = new Set(group.map(i => axis === 'horizontal' ? Math.floor(i / world.width) : i % world.width));
    expect(lanes.size).toBeGreaterThanOrEqual(1); expect(lanes.size).toBeLessThanOrEqual(3);
    expect(Math.max(...lanes) - Math.min(...lanes)).toBe(lanes.size - 1);
    widths.add(lanes.size);
    const cells = new Set(group), [dx, dy] = axis === 'horizontal' ? [1, 0] : [0, 1];
    // Side shallows may taper before a bank. At least one continuous lane must
    // still cross all the water, and every flange must connect to that lane.
    let completeSpines = 0;
    for (const lane of lanes) {
      const positions = group.filter(i => (axis === 'horizontal' ? Math.floor(i / world.width) : i % world.width) === lane)
        .map(i => axis === 'horizontal' ? i % world.width : Math.floor(i / world.width));
      const first = Math.min(...positions), last = Math.max(...positions);
      const index = (along: number) => axis === 'horizontal' ? lane * world.width + along : along * world.width + lane;
      expect(positions.length).toBe(last - first + 1);
      if (!WATER.has(world.tiles[index(first - 1)].terrain) && !WATER.has(world.tiles[index(last + 1)].terrain)) completeSpines++;
    }
    expect(completeSpines, 'each ford retains a complete crossing through the river').toBeGreaterThan(0);
    for (const i of group) {
      const x = i % world.width, y = Math.floor(i / world.width);
      expect(world.tiles[i].terrain).toBe('river');
      expect(fordCrossingAxis(world, x, y)).toBe(axis);
      expect(traversable(world, x, y)).toBe(true);
      for (const [sx, sy] of [[dx, dy], [-dx, -dy], [dy, dx], [-dy, -dx]]) {
        const nx = x + sx, ny = y + sy;
        if (cells.has(ny * world.width + nx)) expect(canTraverseEdge(world, { x, y }, { x: nx, y: ny })).toBe(true);
      }
    }
  }
  return widths;
}

function wideChannel(seed: string, horizontal: boolean, depth: number): World {
  const width = 48, height = 48;
  return { width, height, seed, spawns: [], source: 'wide ford fixture', tiles: Array.from({ length: width * height }, (_, i) => {
    const along = horizontal ? Math.floor(i / width) : i % width;
    return { terrain: along >= 20 && along < 20 + depth ? 'river' : 'grassland', overlay: 'none',
      elevation: .2, moisture: .5, food: 3, production: 1, gold: 0, variation: .3 };
  }) };
}

describe('wide meandering rivers and complete fords', () => {
  it('keeps rivers connected to the sea when their drainage crosses scattered lakes', () => {
    const world = generateWorld('connected-world-7', 274, 216, { style: 'fractal', parameters: chosenLandscape.parameters });
    const connected = new Set<number>(), queue: number[] = [];
    for (let i = 0; i < world.tiles.length; i++) if (['ocean', 'coast'].includes(world.tiles[i].terrain)) {
      connected.add(i); queue.push(i);
    }
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head], x = cell % world.width, y = Math.floor(cell / world.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || connected.has(next) || !WATER.has(world.tiles[next].terrain)) continue;
        connected.add(next); queue.push(next);
      }
    }
    expect(world.tiles.some(tile => tile.terrain === 'lake')).toBe(true);
    const isolated = world.tiles.flatMap((tile, cell) => tile.terrain === 'river' && !connected.has(cell) ? [cell] : []);
    // Skipping lake vertices during smoothing painted a detached 14-cell
    // river patch here, instead of following the actual lake entrance/exit.
    expect(isolated).toEqual([]);
  });

  it('crosses every tile of three- and five-tile rivers in both directions', () => {
    const observedWidths = new Set<number>(); let irregular = 0;
    for (const horizontal of [false, true]) for (const depth of [3, 5]) for (let seed = 0; seed < 4; seed++) {
      const world = wideChannel(`ford-${seed}`, horizontal, depth);
      expect(addRiverFords(world)).toBe(true);
      expect(fordGroups(world).length).toBeGreaterThanOrEqual(2);
      for (const width of checkCrossings(world)) observedWidths.add(width);
      for (const group of fordGroups(world)) {
        const xs = group.map(i => i % world.width), ys = group.map(i => Math.floor(i / world.width));
        if (group.length < (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1)) irregular++;
      }
      const saved = structuredClone(world);
      expect(addRiverFords(world)).toBe(false); expect(world).toEqual(saved);
    }
    expect([...observedWidths].sort()).toEqual([1, 2, 3]);
    expect(irregular, 'straight riverbanks should still receive varied tapered crossings').toBeGreaterThan(12);
  });

  it('never treats a lake or ocean as the far bank of a ford', () => {
    for (const water of ['lake', 'coast', 'ocean'] as const) {
      const world = wideChannel(`missing-bank-${water}`, false, 5);
      for (let y = 0; y < world.height; y++) for (let x = 25; x < world.width; x++) world.tiles[y * world.width + x].terrain = water;
      expect(addRiverFords(world)).toBe(false);
    }
  });

  it('keeps complete tributary crossings while broad main rivers remain barriers across generated watersheds', () => {
    let tributaryCrossings = 0;
    for (let seed = 0; seed < 30; seed++) {
      const world = generateWorld(`wide-river-audit-${seed}`);
      checkCrossings(world);
      for (const group of fordGroups(world)) {
        if (group.some(cell => world.tiles[cell].channel === 'tributary')) tributaryCrossings++;
      }
      for (const tile of world.tiles) if (tile.channel === 'main' && tile.channelWidth! > 2.5)
        expect(tile.overlay, 'wide main reaches need bridges instead of frequent fords').not.toBe('ford');
      expect(world.tiles.every(tile => !tile.channel || tile.terrain === 'river' && tile.channelWidth! >= 1)).toBe(true);
    }
    expect(tributaryCrossings).toBeGreaterThan(100);
  }, 25000); // Audit every crossing on thirty enlarged worlds.
});
