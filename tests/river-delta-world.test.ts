import { beforeAll, describe, expect, it } from 'vitest';
import { STARTING_FACTION_COUNT } from '../src/game/civilizations';
import { createGame } from '../src/game/simulation';
import { buildingHeight, buildingWidth, WATER, type World } from '../src/game/types';
import { generateWorld } from '../src/world/generator';

const sea = (terrain: string) => terrain === 'ocean' || terrain === 'coast';

describe('coastal deltas through production generation', () => {
  let world: World;
  beforeAll(() => {
    world = generateWorld('ALDER-DELTA', undefined, undefined, { landformFamily: 'river-basin' });
  }, 120_000);

  it('retains open, wet marsh ground through beaches, ecology, soil and resource assignment', () => {
    expect(world.riverDeltas?.length).toBeGreaterThan(0);
    const marsh = world.tiles.filter(tile => tile.marsh);
    expect(marsh.length).toBeGreaterThan(0);
    for (const tile of marsh) {
      expect(tile.delta).toBeDefined();
      expect(tile).toMatchObject({ terrain: 'grassland', overlay: 'none', biome: 'wetland' });
      expect(tile.moisture).toBeGreaterThanOrEqual(.9);
      expect(tile.beach).not.toBe(true);
      expect(tile.palm).not.toBe(true);
      expect(tile.treeClass).toBeUndefined();
      expect(tile.ridge).toBeUndefined();
      expect(tile.stair).toBeUndefined();
      expect(tile.drainage).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(tile.fertility)).toBe(true);
    }
  });

  it('drains every marsh to the sea through an adjacent, downhill and conservative acyclic graph', () => {
    const { tiles, width } = world, count = tiles.length;
    const incoming = new Int32Array(count), runoff = Float64Array.from(tiles,
      tile => sea(tile.terrain) ? 0 : .15 + (tile.rainfall ?? tile.moisture) * .85);
    const input = runoff.reduce((sum, q) => sum + q, 0);
    for (const tile of tiles) {
      expect(Number.isInteger(tile.drainage)).toBe(true);
      expect(tile.drainage).toBeGreaterThanOrEqual(-1);
      expect(tile.drainage).toBeLessThan(count);
      if (tile.drainage! >= 0) incoming[tile.drainage!]++;
    }
    const order = Array.from(incoming).flatMap((n, cell) => n ? [] : [cell]);
    for (let n = 0; n < order.length; n++) {
      const cell = order[n], tile = tiles[cell], next = tile.drainage!;
      expect(tile.flow, `runoff at ${cell}`).toBeCloseTo(runoff[cell], 6);
      if (next < 0) continue;
      expect(Math.max(Math.abs(cell % width - next % width),
        Math.abs(Math.floor(cell / width) - Math.floor(next / width))), `receiver at ${cell}`).toBe(1);
      expect(tile.elevation + 1e-10, `downhill at ${cell}`).toBeGreaterThanOrEqual(tiles[next].elevation);
      if (tile.terrain === 'river') expect(WATER.has(tiles[next].terrain), `wet receiver at ${cell}`).toBe(true);
      if (tile.channel) expect(tile.channelNext).toBe(next);
      runoff[next] += runoff[cell];
      if (--incoming[next] === 0) order.push(next);
    }
    expect(order).toHaveLength(count);
    const output = tiles.reduce((sum, tile) => sum + (tile.drainage! < 0 ? tile.flow! : 0), 0);
    expect(output).toBeCloseTo(input, 6);
    const oceanConnected = new Uint8Array(count), queue: number[] = [];
    tiles.forEach((tile, cell) => {
      const edge = cell < width || cell >= count - width || cell % width === 0 || cell % width === width - 1;
      if (edge && sea(tile.terrain)) { oceanConnected[cell] = 1; queue.push(cell); }
    });
    for (let n = 0; n < queue.length; n++) {
      const cell = queue[n], x = cell % width, y = Math.floor(cell / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= world.height || oceanConnected[next] || !WATER.has(tiles[next].terrain)) continue;
        oceanConnected[next] = 1; queue.push(next);
      }
    }
    for (let cell = 0; cell < count; cell++) if (tiles[cell].marsh) {
      let outlet = cell, steps = 0;
      while (!sea(tiles[outlet].terrain) && tiles[outlet].drainage! >= 0) {
        outlet = tiles[outlet].drainage!;
        if (++steps >= count) break;
      }
      expect(steps).toBeLessThan(count);
      expect(oceanConnected[outlet], `marsh ${cell} reaches connected sea`).toBe(1);
    }
  });

  it('keeps actual starting buildings, roads and farm fields off the preserved marsh', () => {
    const initialMarsh = new Set(world.tiles.flatMap((tile, cell) => tile.marsh ? [cell] : []));
    const state = createGame(world);
    const starting = state.buildings.filter(building => building.faction >= 0 && building.faction < STARTING_FACTION_COUNT);
    expect(starting.some(building => building.kind === 'palace')).toBe(true);
    for (const building of starting) {
      for (let y = building.y; y < building.y + buildingHeight(building); y++)
        for (let x = building.x; x < building.x + buildingWidth(building); x++)
          expect(initialMarsh.has(y * world.width + x), `${building.kind} on marsh at ${x},${y}`).toBe(false);
    }
    for (const field of state.fields ?? [])
      expect(initialMarsh.has(field.y * world.width + field.x), `field on marsh at ${field.x},${field.y}`).toBe(false);
    for (const cell of initialMarsh) expect(world.tiles[cell])
      .toMatchObject({ marsh: true, terrain: 'grassland', overlay: 'none', biome: 'wetland' });
  }, 120_000);
});
