import { describe, expect, it } from 'vitest';
import { placeLandformRelief } from '../src/world/regional-relief';
import type { LandformPlan } from '../src/world/landforms';
import { ridgeEdgeAllowed, ridgeGroundWalkable, ridgeIsLedge, STAIR_UP } from '../src/game/ridges';
import { WATER, type World } from '../src/game/types';
import { DEFAULT_LANDSCAPE_PARAMETERS, type LandformKind } from '../src/world/options';

function flat(seed = 'landform-relief', width = 160, height = 128): World {
  return { width, height, seed, spawns: [], source: 'fixture', tiles: Array.from({ length: width * height }, () => ({
    terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 1, gold: 0, variation: .5,
  })) };
}
function planFor(world: World, family: LandformKind): LandformPlan {
  return { family, provinces: [{ kind: family, center: { x: 80, y: 64 }, radiusX: 60, radiusY: 44, angle: .36 }],
    ridges: [], valleys: [], basins: [], elevation: new Float32Array(world.tiles.length).fill(.55),
    resistance: new Float32Array(world.tiles.length).fill(.6), uplift: new Float32Array(world.tiles.length).fill(.5) };
}
function ridgeBodies(world: World): number[][] {
  const bodies = new Map<number, number[]>();
  world.tiles.forEach((tile, cell) => { if (tile.ridge) { const cells = bodies.get(tile.ridge) ?? []; cells.push(cell); bodies.set(tile.ridge, cells); } });
  return [...bodies.values()];
}
function assertAccessibleFloors(world: World): void {
  const { width, height, tiles } = world, queue = [width + 1], seen = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
    for (const up of Object.values(STAIR_UP)) {
      const nx = x + up.x, ny = y + up.y, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen.has(next) || WATER.has(tiles[next].terrain)
        || !ridgeGroundWalkable(world, nx, ny) || !ridgeEdgeAllowed(world, { x, y }, { x: nx, y: ny })) continue;
      seen.add(next); queue.push(next);
    }
  }
  const stranded: number[] = [], invalidStairs: number[] = [];
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell], x = cell % width, y = Math.floor(cell / width);
    if (tile.ridge && ridgeGroundWalkable(world, x, y) && !seen.has(cell)) stranded.push(cell);
    if (tile.stair && !ridgeGroundWalkable(world, x, y)) invalidStairs.push(cell);
  }
  expect(invalidStairs, 'every native stair has valid landings').toEqual([]);
  expect(stranded, 'every usable upper floor connects to surrounding low ground').toEqual([]);
}

describe('native relief from landform provinces', () => {
  it('follows a diagonal branching mountain skeleton with irregular outlines and usable stairs', () => {
    const world = flat(), plan = planFor(world, 'folded-range');
    plan.ridges.push({ points: [{ x: 22, y: 24 }, { x: 55, y: 40 }, { x: 91, y: 83 }, { x: 135, y: 103 }], width: 9, prominence: .85, kind: 'mountains' },
      { points: [{ x: 55, y: 40 }, { x: 78, y: 25 }, { x: 116, y: 20 }], width: 7, prominence: .7, kind: 'mountains' });
    placeLandformRelief(world, plan);
    const cells = world.tiles.flatMap((tile, cell) => tile.ridge ? [cell] : []), xs = cells.map(cell => cell % world.width), ys = cells.map(cell => Math.floor(cell / world.width));
    expect(cells.length / world.tiles.length).toBeGreaterThan(.04);
    expect(cells.length / world.tiles.length).toBeLessThan(.13);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(95);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(65);
    expect(cells.length / ((Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1))).toBeLessThan(.3);
    expect(world.tiles.some(tile => tile.stair)).toBe(true);
    expect(world.tiles.some(tile => tile.ridgeTier === 2)).toBe(true);
    assertAccessibleFloors(world);
  });

  it('cuts broad plateau contours into distinct usable surfaces around a clear canyon', () => {
    const world = flat('plateau-contours'), plan = planFor(world, 'dissected-plateau');
    plan.valleys.push({ points: [{ x: 34, y: 8 }, { x: 65, y: 43 }, { x: 94, y: 77 }, { x: 127, y: 118 }], width: 9, depth: .35 });
    placeLandformRelief(world, plan);
    const bodies = ridgeBodies(world), floors = bodies.map(cells => cells.filter(cell => !ridgeIsLedge(world, cell % world.width, Math.floor(cell / world.width))).length);
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...floors)).toBeGreaterThan(250);
    for (const point of plan.valleys[0].points) expect(world.tiles[Math.round(point.y) * world.width + Math.round(point.x)].ridge).toBeUndefined();
    assertAccessibleFloors(world);
  });

  it('distinguishes rounded uplands from broad basin floors and responds to the relief budget', () => {
    const uplands = flat('regional-contours'), basin = flat('regional-contours'), dense = flat('regional-contours');
    const hillPlan = planFor(uplands, 'rolling-uplands'), basinPlan = planFor(basin, 'river-basin');
    basinPlan.basins.push({ center: { x: 80, y: 64 }, radiusX: 42, radiusY: 29, angle: .36, lake: false });
    placeLandformRelief(uplands, hillPlan, { ...DEFAULT_LANDSCAPE_PARAMETERS, reliefCoverage: .04 });
    placeLandformRelief(dense, hillPlan, { ...DEFAULT_LANDSCAPE_PARAMETERS, reliefCoverage: .14 });
    placeLandformRelief(basin, basinPlan);
    const count = (world: World) => world.tiles.filter(tile => tile.ridge).length;
    expect(count(dense)).toBeGreaterThan(count(uplands) * 2);
    expect(ridgeBodies(dense).length).toBeGreaterThan(3);
    expect(basin.tiles[64 * basin.width + 80].ridge).toBeUndefined();
    expect(basin.tiles.map(tile => tile.ridge ?? 0)).not.toEqual(dense.tiles.map(tile => tile.ridge ?? 0));
    for (const world of [uplands, dense, basin]) assertAccessibleFloors(world);
  });

  it('retains meaningful mountain balance and hill shape controls within the same regional plan', () => {
    const low = flat('province-controls'), high = flat('province-controls'), small = flat('province-controls'), broad = flat('province-controls');
    const plan = planFor(low, 'rolling-uplands');
    plan.ridges.push({ points: [{ x: 26, y: 25 }, { x: 63, y: 42 }, { x: 125, y: 97 }], width: 8, prominence: .8, kind: 'mountains' });
    placeLandformRelief(low, plan, { ...DEFAULT_LANDSCAPE_PARAMETERS, mountainShare: .25 });
    placeLandformRelief(high, plan, { ...DEFAULT_LANDSCAPE_PARAMETERS, mountainShare: .7 });
    const mountains = (world: World) => world.tiles.filter(tile => tile.ridge && tile.relief === 'mountains').length;
    expect(mountains(high)).toBeGreaterThan(mountains(low));
    const hills = planFor(small, 'rolling-uplands');
    placeLandformRelief(small, hills, { ...DEFAULT_LANDSCAPE_PARAMETERS, hillSize: .7, hillSpacing: .65, hillClustering: .4 });
    placeLandformRelief(broad, hills, { ...DEFAULT_LANDSCAPE_PARAMETERS, hillSize: 1.5, hillSpacing: 1.5, hillClustering: .95 });
    expect(small.tiles.map(tile => !!tile.ridge)).not.toEqual(broad.tiles.map(tile => !!tile.ridge));
    expect(Math.max(...ridgeBodies(broad).map(cells => cells.length))).toBeGreaterThan(Math.max(...ridgeBodies(small).map(cells => cells.length)));
  });

  it('preserves inland and ocean aprons, lake reservations and deterministic contours', () => {
    const world = flat('water-safe-contours'), plan = planFor(world, 'rift-lakes');
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < 10; x++) world.tiles[y * world.width + x].terrain = 'ocean';
      world.tiles[y * world.width + 95].terrain = 'river';
    }
    plan.ridges.push({ points: [{ x: 9, y: 20 }, { x: 80, y: 58 }, { x: 130, y: 100 }], width: 10, prominence: .8, kind: 'mountains' });
    plan.basins.push({ center: { x: 65, y: 51 }, radiusX: 10, radiusY: 7, angle: .4, lake: true });
    const repeat = structuredClone(world);
    placeLandformRelief(world, plan); placeLandformRelief(repeat, plan);
    expect(repeat).toEqual(world);
    expect(world.tiles.some(tile => tile.ridge)).toBe(true);
    for (let cell = 0; cell < world.tiles.length; cell++) if (world.tiles[cell].ridge) {
      const x = cell % world.width, y = Math.floor(cell / world.width);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const terrain = world.tiles[(y + dy) * world.width + x + dx].terrain;
        expect(['ocean', 'coast'].includes(terrain)).toBe(false);
        if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) expect(WATER.has(terrain)).toBe(false);
      }
    }
    expect(world.tiles[51 * world.width + 65].ridge).toBeUndefined();
  });
});
