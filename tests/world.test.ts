import { STARTING_FACTION_COUNT, OPPOSING_FACTION_COUNT } from '../src/game/civilizations';
import { describe, expect, it } from 'vitest';
import { generateWorld, normalizePunyWorld } from '../src/world/generator';
import { WATER, type World } from '../src/game/types';
import { canTraverseEdge, traversable } from '../src/game/pathfinding';
import { EARTH_SAMPLES } from '../src/world/data/earth-samples';
import { treeClimateLatitude } from '../src/world/tree-climate';
import { DEFAULT_LANDSCAPE_PARAMETERS } from '../src/world/options';

const passable = (world: World, index: number) => {
  const tile = world.tiles[index];
  return !!tile && traversable(world, index % world.width, Math.floor(index / world.width));
};

function reachable(world: World): Set<number> {
  const start = Math.floor(world.spawns[0].y) * world.width + Math.floor(world.spawns[0].x);
  const found = new Set([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head], x = index % world.width, y = Math.floor(index / world.width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || found.has(next) || !passable(world, next)) continue;
      if (!canTraverseEdge(world, { x, y }, { x: nx, y: ny })) continue;
      found.add(next);
      queue.push(next);
    }
  }
  return found;
}

function waterWithOutlets(world: World): Set<number> {
  const found = new Set<number>();
  const queue: number[] = [];
  for (let i = 0; i < world.tiles.length; i++) {
    if (!['ocean', 'coast'].includes(world.tiles[i].terrain)) continue;
    found.add(i);
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % world.width, y = Math.floor(i / world.width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || found.has(next) || !WATER.has(world.tiles[next].terrain)) continue;
      found.add(next);
      queue.push(next);
    }
  }
  return found;
}

function longestStraightRiver(world: World): number {
  let longest = 0;
  for (const [along, across, length, count] of [[1, world.width, world.width, world.height], [world.width, 1, world.height, world.width]]) {
    for (let line = 0; line < count; line++) {
      let run = 0;
      for (let position = 0; position < length; position++) {
        run = world.tiles[line * across + position * along].terrain === 'river' ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
    }
  }
  return longest;
}

function overlayPatches(world: World, overlays = ['forest', 'jungle']): number[] {
  const wooded = (i: number) => overlays.includes(world.tiles[i].overlay);
  const seen = new Set<number>(), sizes: number[] = [];
  for (let start = 0; start < world.tiles.length; start++) {
    if (seen.has(start) || !wooded(start)) continue;
    const queue = [start];
    seen.add(start);
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], x = i % world.width, y = Math.floor(i / world.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || seen.has(next) || !wooded(next)) continue;
        seen.add(next); queue.push(next);
      }
    }
    sizes.push(queue.length);
  }
  return sizes;
}

function oceanShore(world: World): Set<number> {
  const shore = new Set<number>();
  for (let i = 0; i < world.tiles.length; i++) {
    if (WATER.has(world.tiles[i].terrain)) continue;
    const x = i % world.width, y = Math.floor(i / world.width);
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < world.width && ny < world.height
        && ['ocean', 'coast'].includes(world.tiles[ny * world.width + nx].terrain);
    })) shore.add(i);
  }
  return shore;
}

const warmLatitude = (world: World, index: number): boolean =>
  treeClimateLatitude(Math.floor(index / world.width), world.height, world.generationParameters) <= .43;

describe('geographic world generation', () => {
  it('uses reproducible geographic training samples with both land and water', () => {
    expect(EARTH_SAMPLES.length).toBeGreaterThanOrEqual(8);
    for (const sample of EARTH_SAMPLES) {
      expect(sample.rows).toHaveLength(64);
      expect(sample.rows.every(row => /^[01]{64}$/.test(row))).toBe(true);
    }
    expect(EARTH_SAMPLES.flatMap(sample => sample.rows).join('')).toContain('010');
  });

  it('reproduces the same seeded world and changes the landscape with another seed', () => {
    const first = generateWorld('map-repeatability');
    expect(generateWorld('map-repeatability')).toEqual(first);
    const another = generateWorld('another-continent');
    expect(another.tiles).not.toEqual(first.tiles);
    const coastline = (world: World) => world.tiles.map(tile => tile.terrain === 'ocean' || tile.terrain === 'coast');
    expect(coastline(another)).not.toEqual(coastline(first));
  // Three full-size worlds plus deep equality can exceed the default timeout
  // when the full suite runs alongside long settlement simulations.
  }, 120_000);

  it.each(['CROWN', 'river-kingdom', '42', 'autumn', 'first-light', 'a', '0', ''])('places six separated, connected, viable capitals for seed %s', seed => {
    const world = generateWorld(seed);
    expect(world.tiles).toHaveLength(world.width * world.height);
    expect(world.spawns).toHaveLength(STARTING_FACTION_COUNT);
    const connected = reachable(world);
    expect(connected.size).toBeGreaterThan(1200);
    for (let i = 0; i < world.spawns.length; i++) {
      const spawn = world.spawns[i], x = Math.floor(spawn.x), y = Math.floor(spawn.y);
      expect(connected.has(y * world.width + x)).toBe(true);
      let space = 0;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        if (dx * dx + dy * dy <= 25 && passable(world, (y + dy) * world.width + x + dx)) space++;
      }
      expect(space).toBeGreaterThanOrEqual(65);
      // The palace and immediate camp clearing have no obstacles.
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const tile = world.tiles[(y + dy) * world.width + x + dx];
        expect(tile.overlay).toBe('none');
        expect(tile.beach).not.toBe(true);
        expect(tile.palm).not.toBe(true);
      }
      for (let j = 0; j < i; j++) expect(Math.hypot(spawn.x - world.spawns[j].x, spawn.y - world.spawns[j].y)).toBeGreaterThanOrEqual(18);
    }
    for (const tile of world.tiles) {
      expect(Number.isFinite(tile.elevation)).toBe(true);
      expect(tile.food).toBeGreaterThanOrEqual(0);
      expect(tile.production).toBeGreaterThanOrEqual(0);
      expect(tile.gold).toBeGreaterThanOrEqual(0);
    }
  });

  it('provides varied terrain and inland water without coast/land gaps', () => {
    const worlds = ['CROWN', 'river-kingdom', '42'].map(seed => generateWorld(seed));
    const terrain = new Set(worlds.flatMap(world => world.tiles.map(tile => tile.terrain)));
    const overlays = new Set(worlds.flatMap(world => world.tiles.map(tile => tile.overlay)));
    for (const expected of ['ocean', 'coast', 'river', 'lake', 'grassland', 'plains', 'desert'] as const) expect(terrain.has(expected)).toBe(true);
    expect([...overlays].sort()).toEqual(['ford', 'forest', 'none']);
    for (const unsupported of ['tundra', 'jungle', 'swamp', 'volcano', 'glacier', 'hills', 'mountains', 'rocks']) {
      expect(terrain.has(unsupported as never)).toBe(false);
      expect(overlays.has(unsupported as never)).toBe(false);
    }
    for (const world of worlds) {
      const landCount = world.tiles.filter(tile => !WATER.has(tile.terrain)).length;
      expect(landCount / world.tiles.length).toBeGreaterThan(0.25);
      expect(landCount / world.tiles.length).toBeLessThan(0.85);
      for (let y = 1; y < world.height - 1; y++) for (let x = 1; x < world.width - 1; x++) {
        if (world.tiles[y * world.width + x].terrain !== 'ocean') continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          expect(WATER.has(world.tiles[(y + dy) * world.width + x + dx].terrain)).toBe(true);
        }
      }
    }
  });

  it('normalizes retired terrain in old saves without invisible obstacles', () => {
    const world = generateWorld('legacy-terrain');
    Object.assign(world.tiles[0], { terrain: 'tundra', overlay: 'glacier', food: 4 });
    Object.assign(world.tiles[1], { terrain: 'grassland', overlay: 'jungle' });
    Object.assign(world.tiles[2], { terrain: 'grassland', overlay: 'swamp' });
    Object.assign(world.tiles[3], { terrain: 'grassland', overlay: 'volcano' });
    normalizePunyWorld(world);
    expect(world.tiles.slice(0, 4).map(t => [t.terrain, t.overlay])).toEqual([['grassland', 'none'], ['grassland', 'forest'], ['grassland', 'none'], ['grassland', 'none']]);
    expect(world.revision).toBe(1);
    const normalized = structuredClone(world);
    normalizePunyWorld(world);
    expect(world).toEqual(normalized);
  });

  it('rejects unsupported sizes explicitly', () => {
    expect(() => generateWorld('too-small', 20, 20)).toThrow(RangeError);
  });

  it('clears hills and mountains in existing worlds without changing their ground or bonuses', () => {
    const world = generateWorld('legacy-uplands');
    const hill = world.tiles.find(tile => tile.terrain === 'grassland' && tile.overlay === 'none')!;
    const mountain = world.tiles.find(tile => tile.terrain === 'plains' && tile.overlay === 'none')!;
    Object.assign(hill, { overlay: 'hills', food: 5, production: 2, gold: 1 });
    Object.assign(mountain, { overlay: 'mountains', food: 4, production: 3, gold: 2 });
    const ground = { ...hill, overlay: 'none' };
    const mountainGround = { ...mountain, overlay: 'none' };

    normalizePunyWorld(world);

    expect(hill).toEqual(ground);
    expect(mountain).toEqual(mountainGround);
    expect(world.tiles.some(tile => ['hills', 'mountains'].includes(tile.overlay as string))).toBe(false);
    expect(world.revision).toBe(1);
    const normalized = structuredClone(world);
    normalizePunyWorld(world);
    expect(world).toEqual(normalized);
  });

  it('bends the BTV-847 river through valleys instead of drawing a long straight canal', () => {
    // The approved preset has wider banks, whose overlapping raster runs can
    // exceed a straight centerline. Keep any such run below a third of the map.
    const world = generateWorld('BTV-847', 112, 88);
    expect(longestStraightRiver(world)).toBeLessThan(world.width / 3);
  });

  it('grows regionally varied woodland with open ground throughout every stand', () => {
    for (const seed of ['BTV-847', 'forest-patches-1', 'forest-patches-8', 'forest-patches-21']) {
      const world = generateWorld(seed), sizes = overlayPatches(world);
      const total = sizes.reduce((sum, size) => sum + size, 0);
      const land = world.tiles.filter(tile => !WATER.has(tile.terrain)).length;
      expect(total / land, `${seed}: recognizable woodland regions`).toBeGreaterThan(.15);
      expect(total / land, `${seed}: open ground between trees`).toBeLessThan(.32);
      expect(Math.max(...sizes) / total, `${seed}: several distinct stands`).toBeLessThan(.3);
      const solidSquares: number[] = [], withoutOpening: number[] = [];
      for (let i = 0; i < world.tiles.length; i++) {
        if (world.tiles[i].overlay !== 'forest') continue;
        const x = i % world.width, y = Math.floor(i / world.width);
        if (x + 1 < world.width && y + 1 < world.height && [i + 1, i + world.width, i + world.width + 1]
          .every(next => world.tiles[next].overlay === 'forest')) solidSquares.push(i);
        const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) return false;
          const next = ny * world.width + nx, neighbor = world.tiles[next];
          return !WATER.has(neighbor.terrain) && neighbor.overlay === 'none' && passable(world, next)
            && canTraverseEdge(world, { x, y }, { x: nx, y: ny });
        });
        if (!open) withoutOpening.push(i);
      }
      expect(solidSquares, `${seed}: no solid 2×2 canopy`).toEqual([]);
      expect(withoutOpening, `${seed}: every tree touches traversable open ground`).toEqual([]);
      // Measure regions at a larger scale than the deliberate single-cell gaps.
      // Uniformly scattering the same number of trees would lose this variation.
      const regions: number[] = [];
      for (let y = 0; y + 16 <= world.height; y += 16) for (let x = 0; x + 16 <= world.width; x += 16) {
        let ground = 0, woods = 0;
        for (let dy = 0; dy < 16; dy++) for (let dx = 0; dx < 16; dx++) {
          const tile = world.tiles[(y + dy) * world.width + x + dx];
          if (!WATER.has(tile.terrain)) { ground++; woods += Number(tile.overlay === 'forest'); }
        }
        if (ground >= 128) regions.push(woods / ground);
      }
      regions.sort((a, b) => a - b);
      expect(regions[Math.floor(regions.length * .9)] - regions[Math.floor(regions.length * .1)],
        `${seed}: distinct woodland regions survive thinning`).toBeGreaterThan(.12);
    }
  });

  it('keeps beaches within three dry tiles of the sea, with occasional spaced palms', () => {
    for (const seed of ['CROWN', 'river-kingdom', 'BTV-847']) {
      const world = generateWorld(seed), shore = oceanShore(world);
      const reached = new Map<number, number>();
      const queue = [...shore].filter(i => world.tiles[i].beach);
      for (const i of queue) reached.set(i, 1);
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head], depth = reached.get(i)!;
        if (depth >= 3) continue;
        const x = i % world.width, y = Math.floor(i / world.width);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
          if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || reached.has(next) || !world.tiles[next].beach) continue;
          reached.set(next, depth + 1); queue.push(next);
        }
      }
      const beach = world.tiles.flatMap((tile, i) => tile.beach ? [i] : []);
      const palms = world.tiles.flatMap((tile, i) => tile.palm ? [i] : []);
      expect(beach.length).toBeGreaterThan(100);
      expect(reached.size, `${seed}: no detached inland beaches`).toBe(beach.length);
      expect([...reached.values()]).toContain(3);
      for (const i of beach) {
        expect(world.tiles[i].terrain).toBe('desert');
        expect(world.tiles[i].overlay).toBe('none');
        expect(passable(world, i)).toBe(true);
      }
      for (const i of shore) if (!world.tiles[i].beach) expect(world.tiles[i].terrain).toBe('grassland');
      const warmBeaches = beach.filter(i => warmLatitude(world, i));
      expect(palms.length / warmBeaches.length).toBeGreaterThan(.02);
      expect(palms.length / warmBeaches.length).toBeLessThan(.1);
      for (const i of palms) {
        expect(world.tiles[i].beach).toBe(true);
        expect(warmLatitude(world, i)).toBe(true);
        expect(world.tiles[i].treeClass).toBe('tropical');
        for (const j of palms) if (j > i) expect(Math.hypot(j % world.width - i % world.width, Math.floor(j / world.width) - Math.floor(i / world.width))).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps connected settlements, hierarchical rivers, and configured non-marsh sandy coasts across a hundred worlds', async () => {
    let longestRunTotal = 0;
    let shoreTotal = 0, sandyShoreTotal = 0, warmBeachTotal = 0, palmTotal = 0;
    for (let index = 0; index < 100; index++) {
      // Let Vitest service worker messages during this intentionally long sweep.
      if (index % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      // Keep this hundred-seed ecology/drainage audit at a fixed size. The
      // real-game sizes and 80-tile realm separation have their own coverage.
      const world = generateWorld(`connected-world-${index}`, 194, 153);
      longestRunTotal += longestStraightRiver(world) / (world.width / 112);
      const shore = new Set([...oceanShore(world)].filter(i => !world.tiles[i].marsh));
      const sandyShore = [...shore].filter(i => world.tiles[i].terrain === 'desert' || world.tiles[i].terrain === 'plains').length;
      shoreTotal += shore.size; sandyShoreTotal += sandyShore;
      warmBeachTotal += world.tiles.filter((tile, i) => tile.beach && warmLatitude(world, i)).length;
      palmTotal += world.tiles.filter(tile => tile.palm).length;
      expect(world.tiles.every((tile, i) => !tile.palm || warmLatitude(world, i) && tile.treeClass === 'tropical')).toBe(true);
      expect(sandyShore / shore.size, `seed ${index}: actual sand art at the shoreline`).toBeGreaterThanOrEqual(DEFAULT_LANDSCAPE_PARAMETERS.beachFraction - .01);
      expect(sandyShore / shore.size, `seed ${index}: actual sand art at the shoreline`).toBeLessThanOrEqual(DEFAULT_LANDSCAPE_PARAMETERS.beachFraction + .01);
      let matching = 0, links = 0;
      for (const i of shore) {
        const x = i % world.width, y = Math.floor(i / world.width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
          if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || next <= i || !shore.has(next)) continue;
          links++;
          if (!!world.tiles[i].beach === !!world.tiles[next].beach) matching++;
        }
      }
      expect(matching / links, `seed ${index}: coherent coastal stretches`).toBeGreaterThan(.8);
      const connected = reachable(world);
      expect(world.spawns, `seed ${index}`).toHaveLength(STARTING_FACTION_COUNT);
      for (let a = 0; a < world.spawns.length; a++) {
        const spawn = world.spawns[a];
        expect(connected.has(Math.floor(spawn.y) * world.width + Math.floor(spawn.x)), `seed ${index}, faction ${a}`).toBe(true);
        for (let b = 0; b < a; b++) expect(Math.hypot(spawn.x - world.spawns[b].x, spawn.y - world.spawns[b].y)).toBeGreaterThanOrEqual(18);
      }
      const outlets = waterWithOutlets(world);
      let wideRiverBlocks = 0, disconnectedRiverTiles = 0, riverTiles = 0;
      expect([...new Set(world.tiles.map(tile => tile.overlay))].sort(), `seed ${index}: supported overlays only`).toEqual(['ford', 'forest', 'none']);
      for (let y = 0; y < world.height - 1; y++) for (let x = 0; x < world.width - 1; x++) {
        const i = y * world.width + x, tile = world.tiles[i];
        if (tile.terrain === 'river') {
          riverTiles++;
          if (!outlets.has(i)) disconnectedRiverTiles++;
          if ([i + 1, i + world.width, i + world.width + 1].every(next => world.tiles[next].terrain === 'river')) wideRiverBlocks++;
        }
      }
      expect(world.tiles.some(tile => 'ramp' in tile || 'rampDirection' in tile), `seed ${index}: no retired stair data`).toBe(false);
      expect(riverTiles, `seed ${index}`).toBeGreaterThan(20);
      // Narrow tributaries now intentionally outnumber broad water. Wide
      // channels must still exist, without imposing the old all-rivers-wide ratio.
      expect(wideRiverBlocks, `seed ${index}: broad continuous channels`).toBeGreaterThan(0);
      expect(world.tiles.every(tile => !tile.channel || tile.terrain === 'river' && tile.channelWidth! >= 1), `seed ${index}: no creek ribbons`).toBe(true);
      expect(world.tiles.some(tile => tile.channel === 'tributary' && tile.channelWidth === 1), `seed ${index}: narrow tributaries`).toBe(true);
      expect(disconnectedRiverTiles, `seed ${index}: rivers without cardinal outlet`).toBe(0);
    }
    expect(longestRunTotal / 100, 'average longest straight river segment relative to map width, including broad banks').toBeLessThan(28);
    expect(sandyShoreTotal / shoreTotal, 'average visible sandy non-marsh coastline').toBeCloseTo(DEFAULT_LANDSCAPE_PARAMETERS.beachFraction, 2);
    expect(palmTotal / warmBeachTotal, 'occasional palms across warm beaches').toBeGreaterThan(.03);
    expect(palmTotal / warmBeachTotal, 'occasional palms across warm beaches').toBeLessThan(.07);
  // Budget for a hundred full climate/terrain runs and two watershed passes
  // per map while checking all geographic and navigation invariants.
  }, 120000);
});
