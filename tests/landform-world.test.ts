import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world/generator';
import { LANDFORM_KINDS } from '../src/world/options';
import { STARTING_FACTION_COUNT, OPPOSING_FACTION_COUNT } from '../src/game/civilizations';
import { canTraverseEdge, traversable } from '../src/game/pathfinding';
import { WATER, type World } from '../src/game/types';

const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
function reachable(world: World, seeds: number[], water = false): Set<number> {
  const queue = seeds.slice(), seen = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % world.width, y = Math.floor(cell / world.width);
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || seen.has(next)) continue;
      if (water ? !WATER.has(world.tiles[next].terrain)
        : !traversable(world, nx, ny) || !canTraverseEdge(world, { x, y }, { x: nx, y: ny })) continue;
      seen.add(next); queue.push(next);
    }
  }
  return seen;
}

describe('geological worlds', () => {
  it.each(['GEOLOGY-PLAYABILITY', 'ALDER-REACH', 'SILVER-WATERS'])('creates six playable landscapes with connected settlements and complete drainage for %s', seed => {
    const signatures = new Set<string>();
    for (const family of LANDFORM_KINDS) {
      // Keep this terrain audit comparable to its recorded geometry baseline;
      // production-sized faction spacing has its own generation tests.
      const world = generateWorld(seed, 194, 153, { landformFamily: family });
      expect(world.landformFamily).toBe(family);
      expect(world.landformProvinces?.some(province => province.kind === family)).toBe(true);
      expect(world.spawns).toHaveLength(STARTING_FACTION_COUNT);
      expect(world.secondarySpawns).toHaveLength(OPPOSING_FACTION_COUNT);
      const first = world.spawns[0], paths = reachable(world, [Math.floor(first.y) * world.width + Math.floor(first.x)]);
      for (const town of [...world.spawns, ...world.secondarySpawns!])
        expect(paths.has(Math.floor(town.y) * world.width + Math.floor(town.x)), `${family}: connected town`).toBe(true);
      const sea = world.tiles.flatMap((tile, cell) => tile.terrain === 'ocean' || tile.terrain === 'coast' ? [cell] : []);
      const wet = reachable(world, sea, true), badWater: number[] = [];
      for (let cell = 0; cell < world.tiles.length; cell++) {
        if (world.tiles[cell].terrain === 'river' && !wet.has(cell)) badWater.push(cell);
      }
      expect(badWater, `${family}: water outlets`).toEqual([]);
      if (family === 'rift-lakes') expect(world.tiles.some(tile => tile.terrain === 'lake' && tile.lakeShape === 'compact')).toBe(true);
      expect(world.tiles.some(tile => tile.lakeShape === 'snaky')).toBe(false);
      signatures.add(world.tiles.map(tile => `${tile.terrain[0]}${Math.round(tile.elevation * 10)}`).join(''));
    }
    expect(signatures.size).toBe(LANDFORM_KINDS.length);
  }, 180000);

  it('repeats chosen landforms exactly and rejects unknown families', () => {
    const options = { landformFamily: 'dissected-plateau' as const };
    expect(generateWorld('GEOLOGY-REPEAT', 160, 128, options)).toEqual(generateWorld('GEOLOGY-REPEAT', 160, 128, options));
    expect(() => generateWorld('bad-family', undefined, undefined, { landformFamily: 'nonsense' as never })).toThrow(RangeError);
  }, 120000);
});
