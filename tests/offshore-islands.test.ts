import { STARTING_FACTION_COUNT, OPPOSING_FACTION_COUNT } from '../src/game/civilizations';
import { createNoise2D } from 'simplex-noise';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_HEIGHT, DEFAULT_WORLD_WIDTH, generateWorld, seededRandom } from '../src/world/generator';
import { addOffshoreIslands, createLandformProfile, landformDensity } from '../src/world/islands';
import { WATER } from '../src/game/types';

describe('offshore islands', () => {
  it('varies regional lobes between seeds and cuts a curved continental sea passage', () => {
    const profiles = Array.from({ length: 8 }, (_, n) => createLandformProfile(seededRandom(`regional-layout-${n}`), 274, 216, 'pangaea'));
    expect(new Set(profiles.map(profile => profile.bodies.length)).size).toBeGreaterThan(1);
    const profile = createLandformProfile(seededRandom('curved-strait'), 274, 216, 'continents');
    profile.mirrorX = false; profile.mirrorY = false; profile.transpose = false;
    const strait = profile.strait!, centers: number[] = [];
    for (const v of [.2, .35, .5, .65, .8]) {
      const u = strait.center + Math.sin(v * Math.PI * 2 + strait.phase) * strait.bend + (v - .5) * strait.tilt;
      centers.push(u);
      expect(landformDensity(profile, u * 274, v * 216, 274, 216, () => 0)).toBeLessThan(-.2);
    }
    expect(Math.max(...centers) - Math.min(...centers)).toBeGreaterThan(.015);
  });

  it.each(['offshore-1', 'offshore-2', 'offshore-3'])('adds separate irregular islands within ten water tiles of the mainland: %s', seed => {
    const width = 112, height = 88, mask = new Uint8Array(width * height);
    for (let y = 20; y < 68; y++) for (let x = 24; x < 88; x++) mask[y * width + x] = 1;
    const original = mask.slice(), random = seededRandom(seed);
    const islands = addOffshoreIslands(mask, width, height, random, createNoise2D(random));
    expect(islands.length).toBeGreaterThanOrEqual(4);
    for (const island of islands) {
      expect(island.length).toBeGreaterThanOrEqual(6);
      expect(island.length).toBeLessThan(200);
      const cells = new Set(island), reached = new Set([island[0]]), queue = [island[0]];
      let nearestMainland = Infinity;
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head], x = i % width, y = Math.floor(i / width);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const next = (y + dy) * width + x + dx;
          if (cells.has(next) && !reached.has(next)) { reached.add(next); queue.push(next); }
        }
      }
      expect(reached.size).toBe(island.length);
      for (const i of island) {
        const x = i % width, y = Math.floor(i / width);
        expect(original[i]).toBe(0);
        const dx = Math.max(24 - x, 0, x - 87), dy = Math.max(20 - y, 0, y - 67);
        nearestMainland = Math.min(nearestMainland, Math.hypot(dx, dy));
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const next = (y + oy) * width + x + ox;
          if (!cells.has(next)) expect(mask[next], 'a full water gap separates islands even diagonally').toBe(0);
        }
      }
      expect(nearestMainland).toBeGreaterThanOrEqual(2);
      expect(nearestMainland - 1).toBeLessThanOrEqual(10);
    }
    for (let i = 0; i < original.length; i++) if (original[i]) expect(mask[i]).toBe(1);
    const repeated = original.slice(), repeatedRandom = seededRandom(seed);
    expect(addOffshoreIslands(repeated, width, height, repeatedRandom, createNoise2D(repeatedRandom))).toEqual(islands);
    expect(repeated).toEqual(mask);
  });

  it('halves default map area while preserving aspect ratio and explicit dimensions', () => {
    const large = generateWorld('offshore-world');
    expect(STARTING_FACTION_COUNT).toBe(6);
    expect([large.width, large.height, large.tiles.length]).toEqual([DEFAULT_WORLD_WIDTH, DEFAULT_WORLD_HEIGHT, 194 * 153]);
    expect(large.tiles.length / (274 * 216)).toBeCloseTo(.5, 2);
    expect(large.width / large.height).toBeCloseTo(274 / 216, 2);
    expect(large.spawns).toHaveLength(STARTING_FACTION_COUNT);
    const small = generateWorld('offshore-world', 112, 88);
    expect([small.width, small.height, small.tiles.length]).toEqual([112, 88, 112 * 88]);
    expect(small.spawns).toHaveLength(STARTING_FACTION_COUNT);
  });

  it('keeps selected major landforms distinct without stranding civilizations', () => {
    const expected = ['continents', 'fractal', 'pangaea'] as const;
    const worlds = expected.map(style => generateWorld('CROWN', undefined, undefined, { style }));
    const componentSizes = worlds.map((world, index) => {
      expect(world.generationStyle).toBe(expected[index]);
      expect(world.spawns).toHaveLength(STARTING_FACTION_COUNT);
      expect(world.secondarySpawns).toHaveLength(OPPOSING_FACTION_COUNT);
      // Rivers/lakes divide movement but are interior to the same geographical
      // island. Only sea cells count as gaps when comparing landform sizes.
      const dry = world.tiles.map(tile => tile.terrain !== 'coast' && tile.terrain !== 'ocean');
      const seen = new Set<number>(), components: number[][] = [];
      for (let start = 0; start < dry.length; start++) {
        if (!dry[start] || seen.has(start)) continue;
        const queue = [start]; seen.add(start);
        for (let head = 0; head < queue.length; head++) {
          const i = queue[head], x = i % world.width, y = Math.floor(i / world.width);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
            if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || !dry[next] || seen.has(next)) continue;
            seen.add(next); queue.push(next);
          }
        }
        components.push(queue);
      }
      components.sort((a, b) => b.length - a.length);
      const mainland = new Set(components[0]);
      for (const spawn of [...world.spawns, ...world.secondarySpawns!])
        expect(mainland.has(Math.floor(spawn.y) * world.width + Math.floor(spawn.x))).toBe(true);
      return components.map(component => component.length);
    });
    const [continents, fractal, pangaea] = componentSizes;
    expect(continents.filter(size => size > 1000).length).toBeGreaterThanOrEqual(2);
    expect(fractal.filter(size => size >= 40).length).toBeGreaterThan(pangaea.filter(size => size >= 40).length);
    expect(fractal[1]).toBeGreaterThan(200);
    expect(fractal[1]).toBeLessThan(continents[1]);
    expect(pangaea[0] / pangaea.reduce((a, b) => a + b, 0)).toBeGreaterThan(.95);
    for (const style of expected) {
      const first = createLandformProfile(seededRandom('CROWN:landforms'), DEFAULT_WORLD_WIDTH, DEFAULT_WORLD_HEIGHT, style);
      expect(createLandformProfile(seededRandom('CROWN:landforms'), DEFAULT_WORLD_WIDTH, DEFAULT_WORLD_HEIGHT, style)).toEqual(first);
    }
  });

  it('gives islands the normal climate, woodland, beaches, and terrain yields', () => {
    const world = generateWorld('island-features'), seen = new Set<number>(), components: number[][] = [];
    for (let start = 0; start < world.tiles.length; start++) {
      if (seen.has(start) || WATER.has(world.tiles[start].terrain)) continue;
      const cells = [start]; seen.add(start);
      for (let head = 0; head < cells.length; head++) {
        const i = cells[head], x = i % world.width, y = Math.floor(i / world.width);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
          if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || seen.has(next) || WATER.has(world.tiles[next].terrain)) continue;
          seen.add(next); cells.push(next);
        }
      }
      components.push(cells);
    }
    const islets = components.filter(cells => cells.length >= 6 && cells.length <= 200).flat();
    expect(islets.length).toBeGreaterThan(100);
    expect(islets.some(i => world.tiles[i].overlay === 'forest')).toBe(true);
    expect(islets.some(i => world.tiles[i].beach)).toBe(true);
    expect(islets.some(i => world.tiles[i].terrain === 'grassland')).toBe(true);
    for (const i of islets) {
      const tile = world.tiles[i];
      expect(Number.isFinite(tile.elevation)).toBe(true);
      expect(tile.food).toBeGreaterThanOrEqual(0);
      expect(tile.production).toBeGreaterThanOrEqual(0);
    }
  });
});
