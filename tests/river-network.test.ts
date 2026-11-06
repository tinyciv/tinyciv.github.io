import { describe, expect, it } from 'vitest';
import { generateRiverNetwork, placeNetworkFords, refreshRiverRunoff, repairRiverDrainage } from '../src/world/river-network';
import { DEFAULT_LANDSCAPE_PARAMETERS } from '../src/world/options';
import { WATER, type World } from '../src/game/types';

function watershed(seed = 'SINUOUS-BASIN', width = 96, height = 80): World {
  return { width, height, seed, spawns: [], source: 'test', tiles: Array.from({ length: width * height }, (_, cell) => {
    const x = cell % width, y = Math.floor(cell / width), ocean = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
    const ridge = !ocean && x >= 39 && x <= 57 && y >= 25 && y <= 50;
    return { terrain: ocean ? 'ocean' : 'grassland', overlay: 'none', rainfall: .7, moisture: .7,
      elevation: ocean ? 0 : .1 + Math.min(x, width - x, y, height - y) * .008 + Math.sin(x * .08) * .07 + Math.cos(y * .11) * .05 + (ridge ? .4 : 0),
      food: 3, production: 1, gold: 0, variation: .5,
      ...(ridge ? { ridge: 1, ridgeTier: 1 as const, relief: 'mountains' as const } : {}) };
  }) };
}

function audit(world: World): void {
  const { tiles, width } = world, indegree = new Uint8Array(tiles.length);
  for (const tile of tiles) if (tile.drainage! >= 0) indegree[tile.drainage!]++;
  const queue = tiles.flatMap((_, cell) => indegree[cell] ? [] : [cell]), flow = Float64Array.from(tiles, tile => ['ocean', 'coast'].includes(tile.terrain) ? 0 : .15 + tile.rainfall! * .85);
  for (let n = 0; n < queue.length; n++) {
    const cell = queue[n], next = tiles[cell].drainage!;
    expect(tiles[cell].flow).toBeCloseTo(flow[cell], 6);
    if (next < 0) continue;
    expect(Math.max(Math.abs(next % width - cell % width), Math.abs(Math.floor(next / width) - Math.floor(cell / width)))).toBe(1);
    expect(tiles[cell].elevation + 1e-10).toBeGreaterThanOrEqual(tiles[next].elevation);
    if (tiles[cell].terrain === 'river') expect(WATER.has(tiles[next].terrain), `${cell} (${tiles[cell].channel}, Q${tiles[cell].flow}) drains into ${next} ${tiles[next].terrain} (${tiles[next].channel}, Q${tiles[next].flow})`).toBe(true);
    if (tiles[cell].channel) expect(tiles[cell].channelNext).toBe(next);
    flow[next] += flow[cell]; if (--indegree[next] === 0) queue.push(next);
  }
  expect(queue).toHaveLength(tiles.length);
  const input = tiles.reduce((sum, tile) => sum + (['ocean', 'coast'].includes(tile.terrain) ? 0 : .15 + tile.rainfall! * .85), 0);
  expect(tiles.reduce((sum, tile) => sum + (tile.drainage! < 0 ? tile.flow! : 0), 0)).toBeCloseTo(input, 6);
}

describe('sinuous river networks after landforms', () => {
  it('conserves catchment runoff while exposing only full-tile tributaries and broad rivers', () => {
    const world = watershed('SINUOUS-BASIN', 128, 128), network = generateRiverNetwork(world);
    audit(world);
    expect(network.diagnostics.sources).toBeGreaterThan(0);
    expect(network.diagnostics.tributaries).toBeGreaterThan(40);
    expect(network.diagnostics.main).toBeGreaterThan(10);
    expect(network.cutCells.length).toBeGreaterThan(0);
    for (const tile of world.tiles) {
      if (tile.channel) {
        expect(['tributary', 'main']).toContain(tile.channel);
        expect(tile.terrain).toBe('river');
        expect(tile.channelWidth).toBeGreaterThanOrEqual(1);
        if (tile.channel === 'main') expect(tile.channelWidth).toBeGreaterThanOrEqual(2);
        if (tile.channel === 'main') expect(tile.channelWidth).toBeLessThanOrEqual(4);
      } else if (!WATER.has(tile.terrain)) {
        expect(tile.channelWidth).toBeUndefined();
        expect(tile.channelNext).toBeUndefined();
      }
    }
    // Hillslope runoff still feeds the rivers, without rendered creek geometry
    // or a channel-sized water footprint on those dry cells.
    expect(world.tiles.filter(tile => !WATER.has(tile.terrain) && !tile.channel && tile.flow! > 0).length).toBeGreaterThan(40);
    expect(world.tiles.filter(tile => tile.channel === 'tributary').every(tile => tile.channelWidth === 1)).toBe(true);
    const again = watershed('SINUOUS-BASIN', 128, 128); generateRiverNetwork(again); expect(again).toEqual(world);
  });

  it('keeps receiver geometry fixed while accumulating changed rainfall', () => {
    const world = watershed(); generateRiverNetwork(world);
    const geometry = world.tiles.map(tile => [tile.drainage, tile.channelNext]);
    const oldOutlet = world.tiles.reduce((sum, tile) => sum + (tile.drainage! < 0 ? tile.flow! : 0), 0);
    for (const tile of world.tiles) tile.rainfall = 1;
    refreshRiverRunoff(world); audit(world);
    expect(world.tiles.map(tile => [tile.drainage, tile.channelNext])).toEqual(geometry);
    expect(world.tiles.reduce((sum, tile) => sum + (tile.drainage! < 0 ? tile.flow! : 0), 0)).toBeGreaterThan(oldOutlet);
  });

  it('keeps reservoirs level with one spillway and repairs dry ledge profiles without moving river beds', () => {
    const world = watershed('RESERVOIR-BENDS'), lake: number[] = [];
    for (let y = 35; y < 43; y++) for (let x = 21; x < 29; x++) {
      const cell = y * world.width + x; lake.push(cell);
      Object.assign(world.tiles[cell], { terrain: 'lake', elevation: .05 });
    }
    generateRiverNetwork(world); audit(world);
    expect(new Set(lake.map(cell => world.tiles[cell].elevation)).size).toBe(1);
    expect(lake.filter(cell => world.tiles[world.tiles[cell].drainage!].terrain !== 'lake')).toHaveLength(1);
    // Main watershed flow bypasses the compact lake. Its shore connections
    // are one-cell tributaries, rather than a major river ending in the lake.
    const shore = new Set(lake.flatMap(cell => [-1, 1, -world.width, world.width].map(offset => cell + offset)));
    expect([...shore].filter(cell => world.tiles[cell].channel === 'main')).toHaveLength(0);
    const outlet = lake.find(cell => world.tiles[world.tiles[cell].drainage!].terrain !== 'lake')!;
    expect(world.tiles[world.tiles[outlet].drainage!].channel).toBe('tributary');
    for (const [cell, tile] of world.tiles.entries()) if (tile.channel && world.tiles[tile.channelNext!].terrain === 'lake') {
      expect(tile.channel).toBe('tributary');
      expect(tile.flow).toBeLessThan(200);
      expect(lake).not.toContain(cell);
    }
    const beds = world.tiles.map(tile => tile.channel || WATER.has(tile.terrain) ? tile.elevation : undefined);
    const raised = world.tiles.findIndex(tile => !tile.channel && !WATER.has(tile.terrain) && tile.drainage! >= 0);
    world.tiles[raised].elevation = 1.1;
    repairRiverDrainage(world); audit(world);
    beds.forEach((elevation, cell) => { if (elevation !== undefined) expect(world.tiles[cell].elevation).toBe(elevation); });
  });

  it('limits actual straight main-river cross sections to two through four cells, including the largest width setting', () => {
    const world = watershed('BANKFULL-WIDTH', 128, 128);
    generateRiverNetwork(world, { ...DEFAULT_LANDSCAPE_PARAMETERS, riverWidth: 1.3 });
    const { tiles, width } = world;
    let samples = 0;
    for (const [cell, tile] of tiles.entries()) {
      if (tile.channel !== 'main') continue;
      expect(tile.channelWidth).toBeGreaterThanOrEqual(2);
      expect(tile.channelWidth).toBeLessThanOrEqual(4);
      const next = tile.channelNext!, step = next - cell;
      if (Math.abs(step) !== 1 && Math.abs(step) !== width) continue;
      const line = new Set<number>(); let at = cell;
      // Ignore bends, junctions and neighboring channels; this measures the
      // river's body rather than the combined mouth of two separate rivers.
      for (let n = 0; n < 5; n++, at += step) {
        if (tiles[at]?.channel !== 'main' || tiles[at].channelNext !== at + step) break;
        line.add(at);
      }
      if (line.size < 5) continue;
      const middle = cell + step * 2, x = middle % width, y = Math.floor(middle / width);
      let closeBranch = false;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const neighbor = (y + dy) * width + x + dx;
        if (tiles[neighbor]?.channel && !line.has(neighbor)) closeBranch = true;
      }
      if (closeBranch) continue;
      const across = Math.abs(step) === 1 ? width : 1;
      let span = 1;
      for (const sign of [-1, 1]) for (let n = 1; n <= 6 && tiles[middle + sign * across * n]?.terrain === 'river'; n++) span++;
      expect(span).toBeGreaterThanOrEqual(2); expect(span).toBeLessThanOrEqual(4); samples++;
    }
    expect(samples).toBeGreaterThan(3);
  });

  it('places complete repeatable fords and keeps broad main channels closed', () => {
    const world = watershed(); generateRiverNetwork(world, DEFAULT_LANDSCAPE_PARAMETERS);
    // Relief reconstruction clears the carved water footprint before crossings.
    for (const tile of world.tiles) if (tile.terrain === 'river') { delete tile.ridge; delete tile.ridgeTier; }
    expect(placeNetworkFords(world)).toBe(true);
    const fords = world.tiles.flatMap((tile, cell) => tile.overlay === 'ford' ? [cell] : []);
    expect(fords.length).toBeGreaterThan(10);
    expect(placeNetworkFords(world)).toBe(false);
    for (const cell of fords) {
      const tile = world.tiles[cell], step = tile.fordAxis === 'horizontal' ? 1 : world.width;
      for (const sign of [-1, 1]) {
        let next = cell;
        while (world.tiles[next].terrain === 'river') { expect(world.tiles[next].overlay).toBe('ford'); next += sign * step; }
        expect(WATER.has(world.tiles[next].terrain) || world.tiles[next].ridge).toBeFalsy();
      }
      if (tile.channel === 'main') expect(tile.channelWidth).toBeLessThanOrEqual(2.5);
    }
  });
});
