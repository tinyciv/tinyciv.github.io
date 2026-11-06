import { describe, expect, it } from 'vitest';
import type { World } from '../src/game/types';
import { applyLandformHeights, createLandformPlan, landformAt, shapeLandformCoasts } from '../src/world/landforms';
import { DEFAULT_LANDSCAPE_PARAMETERS, LANDSCAPE_CONTROLS, LANDFORM_KINDS, type LandscapeParameter, type LandformKind } from '../src/world/options';

function mainland(width: number, height: number): Uint8Array {
  return Uint8Array.from({ length: width * height }, (_, cell) => {
    const x = cell % width, y = Math.floor(cell / width);
    return Math.hypot((x - width * .5) / (width * .43), (y - height * .5) / (height * .43)) < 1 ? 1 : 0;
  });
}
function componentSizes(land: Uint8Array, width: number, height: number): number[] {
  const seen = new Uint8Array(land.length), sizes: number[] = [];
  for (let first = 0; first < land.length; first++) {
    if (!land[first] || seen[first]) continue;
    const queue = [first]; seen[first] = 1;
    for (let n = 0; n < queue.length; n++) {
      const cell = queue[n], x = cell % width, y = Math.floor(cell / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || !land[next]) continue;
        seen[next] = 1; queue.push(next);
      }
    }
    sizes.push(queue.length);
  }
  return sizes.sort((a, b) => b - a);
}

describe('geological landform plans', () => {
  it('is deterministic without altering its incoming coast mask', () => {
    const width = 194, height = 153, land = mainland(width, height), original = land.slice();
    const first = createLandformPlan('repeatable-geology', width, height, land, 'mixed');
    const second = createLandformPlan('repeatable-geology', width, height, land, 'mixed');
    expect(first).toEqual(second);
    expect(land).toEqual(original);
    const other = createLandformPlan('different-geology', width, height, land, 'mixed');
    expect(other.elevation).not.toEqual(first.elevation);
  });

  it('creates distinct broad landforms with physically bounded terrain fields', () => {
    const width = 194, height = 153, land = mainland(width, height);
    const heights = new Map<LandformKind, number[]>();
    for (const family of LANDFORM_KINDS) {
      const plan = createLandformPlan('landform-comparison', width, height, land, family);
      expect(plan.provinces).toHaveLength(1);
      expect(plan.provinces[0].kind).toBe(family);
      expect(plan.ridges.length).toBeGreaterThan(0);
      expect(plan.valleys.length).toBeGreaterThan(0);
      const dry = Array.from(plan.elevation).filter((_, cell) => land[cell]);
      heights.set(family, dry);
      expect(Math.max(...dry) - Math.min(...dry), family).toBeGreaterThan(.19);
      expect(Array.from(plan.elevation).every((v, cell) => Number.isFinite(v) && v >= 0 && v <= 1 && (land[cell] || v === 0))).toBe(true);
      expect(Array.from(plan.resistance).every(v => v >= 0 && v <= 1)).toBe(true);
      expect(Array.from(plan.uplift).every(v => v >= 0 && v <= 1)).toBe(true);
    }
    // Compare resulting fields, not merely their labels or feature counts.
    for (let a = 0; a < LANDFORM_KINDS.length; a++) for (let b = a + 1; b < LANDFORM_KINDS.length; b++) {
      const left = heights.get(LANDFORM_KINDS[a])!, right = heights.get(LANDFORM_KINDS[b])!;
      const difference = left.reduce((sum, value, cell) => sum + Math.abs(value - right[cell]), 0) / left.length;
      expect(difference, `${LANDFORM_KINDS[a]} vs ${LANDFORM_KINDS[b]}`).toBeGreaterThan(.04);
    }
    const plateauCap = heights.get('dissected-plateau')!.filter(h => h > .55).length;
    const gentleHigh = heights.get('rolling-uplands')!.filter(h => h > .55).length;
    expect(plateauCap).toBeGreaterThan(heights.get('dissected-plateau')!.length * .2);
    expect(gentleHigh).toBe(0);
  });

  it('limits mixed worlds to one dominant province and two coherent secondary regions', () => {
    const width = 194, height = 153, land = mainland(width, height);
    const plan = createLandformPlan('three-regions', width, height, land, 'mixed');
    expect(plan.provinces).toHaveLength(3);
    const populations = new Map<LandformKind, number>();
    for (let cell = 0; cell < land.length; cell++) if (land[cell]) {
      const kind = landformAt(plan, cell % width, Math.floor(cell / width));
      populations.set(kind, (populations.get(kind) ?? 0) + 1);
    }
    expect(populations.size).toBe(3);
    const main = populations.get(plan.provinces[0].kind)!;
    for (const secondary of plan.provinces.slice(1)) {
      expect(populations.get(secondary.kind)).toBeGreaterThan(land.length * .02);
      expect(populations.get(secondary.kind)).toBeLessThan(main);
    }
  });

  it('preserves default geometry and applies the existing shape controls to actual elevation', () => {
    const width = 194, height = 153, land = mainland(width, height);
    const baseline = createLandformPlan('geology-controls', width, height, land, 'folded-range');
    expect(createLandformPlan('geology-controls', width, height, land, 'folded-range', DEFAULT_LANDSCAPE_PARAMETERS)).toEqual(baseline);
    const controls: LandscapeParameter[] = ['mountainBend', 'mountainLengthMin', 'mountainLengthMax',
      'mountainClumpShare', 'mountainStringShare', 'ruggednessScale', 'riverMeander'];
    for (const key of controls) {
      const changed = createLandformPlan('geology-controls', width, height, land, 'folded-range',
        { ...DEFAULT_LANDSCAPE_PARAMETERS, [key]: LANDSCAPE_CONTROLS[key].max });
      const difference = baseline.elevation.reduce((sum, value, cell) => sum + Math.abs(value - changed.elevation[cell]), 0);
      expect(difference, key).toBeGreaterThan(land.length * .0005);
    }
  });

  it.each([[194, 153], [274, 216]])('cuts coastal glacial troughs and adds basin-mouth fans at %i×%i without splitting the mainland', (width, height) => {
    const original = mainland(width, height), originalCount = original.reduce((sum, value) => sum + value, 0);
    for (const family of ['glacial-coast', 'river-basin'] as const) {
      const land = original.slice(), plan = createLandformPlan('coastal-processes', width, height, land, family);
      shapeLandformCoasts(land, width, height, plan);
      const count = land.reduce((sum, value) => sum + value, 0);
      expect(componentSizes(land, width, height), family).toEqual([count]);
      if (family === 'glacial-coast') {
        expect(count).toBeLessThan(originalCount - 30);
        expect(count).toBeGreaterThanOrEqual(originalCount * .935);
      } else {
        expect(count).toBeGreaterThan(originalCount + 10);
        expect(count).toBeLessThanOrEqual(originalCount * 1.025 + 1);
      }
      expect(Array.from(plan.elevation).every((v, cell) => land[cell] || v === 0)).toBe(true);
    }
  });

  it('gives rift lakes long inland basins below their surroundings and stores height/material fields on tiles', () => {
    const width = 194, height = 153, land = mainland(width, height);
    const plan = createLandformPlan('rift-basins', width, height, land, 'rift-lakes');
    const world: World = { width, height, seed: 'rift-basins', source: 'test', spawns: [], tiles: Array.from(land, dry => ({
      terrain: dry ? 'grassland' : 'ocean', overlay: 'none', elevation: 0, moisture: .5, food: 3, production: 1, gold: 0, variation: 0,
    })) };
    applyLandformHeights(world, plan);
    expect(plan.basins.filter(b => b.lake).length).toBeGreaterThanOrEqual(2);
    for (const basin of plan.basins.filter(b => b.lake)) {
      expect(basin.radiusX).toBeGreaterThan(basin.radiusY * 2);
      const cell = Math.round(basin.center.y) * width + Math.round(basin.center.x);
      const flankX = Math.round(basin.center.x - Math.sin(basin.angle) * basin.radiusY * 2.2);
      const flankY = Math.round(basin.center.y + Math.cos(basin.angle) * basin.radiusY * 2.2);
      expect(land[cell]).toBe(1);
      expect(plan.elevation[cell]).toBeLessThan(plan.elevation[flankY * width + flankX]);
      expect(world.tiles[cell].landform).toBe('rift-lakes');
      expect(world.tiles[cell].rockResistance).toBeGreaterThan(0);
      expect(world.tiles[cell].sediment).toBeGreaterThan(0);
    }
    expect(world.tiles.every((tile, cell) => land[cell] ? tile.elevation > 0 : tile.elevation === 0)).toBe(true);
  });
});
