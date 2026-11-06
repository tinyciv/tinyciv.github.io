import { STARTING_FACTION_COUNT, OPPOSING_FACTION_COUNT } from '../src/game/civilizations';
import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world/generator';
import { WORLD_GENERATION_STYLES } from '../src/world/options';
import { traversable, canTraverseEdge } from '../src/game/pathfinding';
import { type World } from '../src/game/types';

const cardinal = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
function landmasses(world: World): number[][] {
  const visited = new Uint8Array(world.tiles.length), masses: number[][] = [];
  const dry = (i: number) => world.tiles[i].terrain !== 'ocean' && world.tiles[i].terrain !== 'coast';
  for (let i = 0; i < visited.length; i++) {
    if (visited[i] || !dry(i)) continue;
    const queue = [i]; visited[i] = 1;
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head], x = cell % world.width, y = Math.floor(cell / world.width);
      for (const [dx, dy] of cardinal) {
        const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || visited[next] || !dry(next)) continue;
        visited[next] = 1; queue.push(next);
      }
    }
    masses.push(queue);
  }
  return masses.sort((a, b) => b.length - a.length);
}
function connectedTowns(world: World): void {
  const start = Math.floor(world.spawns[0].y) * world.width + Math.floor(world.spawns[0].x);
  const queue = [start], seen = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % world.width, y = Math.floor(cell / world.width);
    for (const [dx, dy] of cardinal) {
      const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || seen.has(next)
        || !traversable(world, nx, ny) || !canTraverseEdge(world, { x, y }, { x: nx, y: ny })) continue;
      seen.add(next); queue.push(next);
    }
  }
  for (const town of [...world.spawns, ...world.secondarySpawns!])
    expect(seen.has(Math.floor(town.y) * world.width + Math.floor(town.x)), `${world.generationStyle}: connected town`).toBe(true);
}

describe('explicit world generation styles', () => {
  it.each(['CROWN', '42', 'first-light'])('makes distinct continent, supercontinent, and branching-island geographies for %s', seed => {
    const proceduralStyles = WORLD_GENERATION_STYLES.filter(style => style !== 'mediterranean');
    const worlds = proceduralStyles.map(style => generateWorld(seed, 274, 216, { style }));
    const [continents, pangaea, fractal] = worlds.map(landmasses);
    expect(continents[1].length).toBeGreaterThan(4000);
    expect(continents[0].length / continents.reduce((sum, mass) => sum + mass.length, 0)).toBeLessThan(.85);
    expect(pangaea[0].length / pangaea.reduce((sum, mass) => sum + mass.length, 0)).toBeGreaterThan(.94);
    expect(fractal.filter(mass => mass.length >= 50).length).toBeGreaterThan(pangaea.filter(mass => mass.length >= 50).length);
    for (let n = 0; n < worlds.length; n++) {
      const world = worlds[n];
      expect(world.generationStyle).toBe(proceduralStyles[n]);
      expect(world.tiles.some(tile => 'hill' in tile), 'No gentle-hill elevation fields').toBe(false);
      expect(world.tiles.some(tile => tile.ridge), 'Native ledge shelves remain').toBe(true);
      expect(world.tiles.some(tile => tile.stair), 'Ledge stair access remains').toBe(true);
      expect(world.spawns).toHaveLength(STARTING_FACTION_COUNT); expect(world.secondarySpawns).toHaveLength(OPPOSING_FACTION_COUNT);
      const mainland = new Set(landmasses(world)[0]);
      for (const town of [...world.spawns, ...world.secondarySpawns!])
        expect(mainland.has(Math.floor(town.y) * world.width + Math.floor(town.x))).toBe(true);
      connectedTowns(world);
    }
  }, 120_000);

  it('repeats an explicit style exactly and defaults to fractal', () => {
    const first = generateWorld('world-menu', 160, 128, { style: 'fractal' });
    expect(generateWorld('world-menu', 160, 128, { style: 'fractal' })).toEqual(first);
    expect(generateWorld('world-menu', 160, 128).generationStyle).toBe('fractal');
    expect(() => generateWorld('bad-style', 160, 128, { style: 'unknown' as never })).toThrow(RangeError);
  });
});
