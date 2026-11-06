import { describe, expect, it } from 'vitest';
import { generateWorld, normalizePunyWorld } from '../src/world/generator';
import { WORLD_STYLE_NAMES } from '../src/world/options';
import { ridgeGroundWalkable, ridgeIsLedge } from '../src/game/ridges';
import { traversable, canTraverseEdge } from '../src/game/pathfinding';
import { WATER, type World } from '../src/game/types';

function reachable(world: World, starts?: number[]): Set<number> {
  const p = world.spawns[0], queue = starts ?? [Math.floor(p.y) * world.width + Math.floor(p.x)], seen = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % world.width, y = Math.floor(cell / world.width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || seen.has(next)
        || !traversable(world, nx, ny) || !canTraverseEdge(world, { x, y }, { x: nx, y: ny })) continue;
      seen.add(next); queue.push(next);
    }
  }
  return seen;
}

describe('Mediterranean geographic world', () => {
  it.each(['MED-200BC', 'CROWN', '42'])('has connected starts, abundant native relief, rivers and varied vegetation for %s', seed => {
    const world = generateWorld(seed, undefined, undefined, { style: 'mediterranean' });
    expect([world.width, world.height]).toEqual([384, 199]);
    expect(world.spawns).toHaveLength(6); expect(world.secondarySpawns).toHaveLength(5);
    const seen = reachable(world);
    for (const p of [...world.spawns, ...world.secondarySpawns!])
      expect(seen.has(Math.floor(p.y) * world.width + Math.floor(p.x)), `connected town ${p.x},${p.y}`).toBe(true);
    const land = world.tiles.filter(t => !WATER.has(t.terrain));
    expect(world.tiles.filter(t => t.terrain === 'river').length).toBeGreaterThan(2000);
    expect(world.tiles.filter(t => t.creek).length).toBeGreaterThan(1000);
    expect(world.tiles.filter(t => t.overlay === 'ford').length).toBeGreaterThan(100);
    expect(land.filter(t => t.ridge).length / land.length).toBeGreaterThan(.15);
    expect(land.filter(t => t.ridgeTier === 2).length).toBeGreaterThan(200);
    expect(land.filter(t => t.stair).length).toBeGreaterThan(100);
    expect(land.filter(t => t.overlay === 'forest').length / land.length).toBeGreaterThan(.15);
    expect(land.filter(t => t.overlay === 'none').length / land.length).toBeGreaterThan(.30);
    expect(new Set(land.filter(t => t.overlay === 'forest').map(t => t.treeClass)).size).toBeGreaterThanOrEqual(3);
    expect(land.some(t => t.marsh)).toBe(true);
    expect(land.some(t => t.ridge && t.overlay === 'forest')).toBe(true);
    // The Alps must read as a connected, layered range in their actual location.
    const alpineRidges = new Map<number, number[]>();
    world.tiles.forEach((tile, cell) => {
      const lon = -12 + (cell % world.width + .5) / world.width * 54;
      const lat = 49 - (Math.floor(cell / world.width) + .5) / world.height * 22;
      if (!tile.ridge || lon < 6 || lon > 16 || lat < 44 || lat > 48) return;
      const tiers = alpineRidges.get(tile.ridge) ?? [0, 0, 0, 0, 0];
      tiers[(tile.ridgeTier ?? 1) - 1]++; alpineRidges.set(tile.ridge, tiers);
    });
    expect([...alpineRidges.values()].some(tiers => tiers[0] > 150 && tiers[1] > 100 && tiers[2] > 40), 'a substantial three-tier Alpine range').toBe(true);
    const exterior = world.tiles.flatMap((tile, cell) => !tile.ridge && traversable(world, cell % world.width, Math.floor(cell / world.width)) ? [cell] : []);
    const accessible = reachable(world, exterior);
    const stranded = world.tiles.flatMap((tile, cell) => tile.ridge && traversable(world, cell % world.width, Math.floor(cell / world.width)) && !accessible.has(cell) ? [cell] : []);
    expect(stranded, 'every walkable terrace has stairs to the surrounding ground').toEqual([]);
    world.tiles.forEach((tile, cell) => {
      if (tile.stair) expect(ridgeGroundWalkable(world, cell % world.width, Math.floor(cell / world.width))).toBe(true);
      if (tile.stair || ridgeIsLedge(world, cell % world.width, Math.floor(cell / world.width))) {
        expect(tile.overlay).toBe('none'); expect(tile.marsh).toBeFalsy();
      }
    });
    const fords = world.tiles.map(t => t.fordAxis);
    normalizePunyWorld(world);
    expect(world.tiles.map(t => t.fordAxis)).toEqual(fords);
  }, 20000);

  it('keeps geography fixed while seeds vary local groves, and supports smaller explicit sizes', () => {
    // The multiplayer worker supplies these compact dimensions explicitly.
    const a = generateWorld('geo-A', 128, 104, { style: 'mediterranean' });
    const b = generateWorld('geo-B', 128, 104, { style: 'mediterranean' });
    expect(a.tiles.map(t => WATER.has(t.terrain))).toEqual(b.tiles.map(t => WATER.has(t.terrain)));
    expect(a.tiles.map(t => t.overlay)).not.toEqual(b.tiles.map(t => t.overlay));
    expect(generateWorld('geo-A', 128, 104, { style: 'mediterranean' })).toEqual(a);
    const connected = reachable(a);
    for (const p of [...a.spawns, ...a.secondarySpawns!])
      expect(connected.has(Math.floor(p.y) * a.width + Math.floor(p.x))).toBe(true);
    expect(WORLD_STYLE_NAMES.mediterranean).toBe('Mediterreanean');
  }, 20000);
});
