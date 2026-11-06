import { describe, expect, it } from 'vitest';
import { dirtRoadArtKey, rasterDirtRoad, TRAIL_ART_VARIANTS, trailArtVariant, type RoadLinks } from '../src/game/road-sprites';
import { buildingKey } from '../src/game/native-art';
import type { Building } from '../src/game/types';
import { punyAtlas } from './puny-atlas';

const atlas = punyAtlas();
const sides = ['north', 'east', 'south', 'west', 'northeast', 'southeast', 'southwest', 'northwest'] as const;
const links = (mask: number) => Object.fromEntries(sides.map((side, i) => [side, !!(mask & 1 << i)])) as unknown as RoadLinks;
const pixel = (pixels: Uint8ClampedArray, x: number, y: number) => Array.from(pixels.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
const coverage = (pixels: Uint8ClampedArray) => pixels.filter((value, i) => i % 4 === 3 && value > 0).length;
const exits = [[16, 0], [31, 16], [16, 31], [0, 16], [31, 0], [31, 31], [0, 31], [0, 0]];
const exposedExits = (mask: number) => !(mask & 16 && mask & 3 || mask & 32 && mask & 6
  || mask & 64 && mask & 12 || mask & 128 && mask & 9);
const border = (pixels: Uint8ClampedArray) => pixels.filter((_, i) => {
  const cell = Math.floor(i / 4), x = cell % 32, y = Math.floor(cell / 32);
  return x < 3 || x > 28 || y < 3 || y > 28;
});

function connectedPixels(pixels: Uint8ClampedArray, start: number): Set<number> {
  const seen = new Set<number>(), pending = [start];
  while (pending.length) {
    const cell = pending.pop()!;
    if (seen.has(cell) || pixels[cell * 4 + 3] !== 255) continue;
    seen.add(cell);
    const x = cell % 32, y = Math.floor(cell / 32);
    // Native diagonal steps may touch at a corner while remaining visually
    // continuous. Grass pixels interrupt neither cardinal nor diagonal cores.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && nx < 32 && ny >= 0 && ny < 32) pending.push(ny * 32 + nx);
    }
  }
  return seen;
}

describe('dirt trail artwork', () => {
  it('narrows straight roads, bends, junctions and diagonal routes without painting the terrain', () => {
    for (const mask of [0, 1, 5, 10, 3, 7, 15, 16 | 64, 32 | 128]) {
      const road = rasterDirtRoad(links(mask), atlas);
      const trail = rasterDirtRoad(links(mask), atlas, 'trail');
      expect(coverage(trail)).toBeLessThan(coverage(road) * .8);
      expect(coverage(trail)).toBeGreaterThan(coverage(road) * .35);
      expect(trail.every((value, i) => i % 4 !== 3 || value === 0 || value === 255)).toBe(true);
    }
  });

  it('uses darker dirt and leaves ordinary road rendering unchanged', () => {
    const shape = links(5), road = rasterDirtRoad(shape, atlas);
    expect(rasterDirtRoad(shape, atlas, 'road')).toEqual(road);
    const original = pixel(road, 16, 16), trail = pixel(rasterDirtRoad(shape, atlas, 'trail'), 16, 16);
    expect(trail[0]).toBeLessThan(original[0]);
    expect(trail[1]).toBeLessThan(original[1]);
    expect(trail[3]).toBe(255);
  });

  it('matches every shared cardinal edge between straights, bends and junctions', () => {
    const rasters = Array.from({ length: 16 }, (_, mask) => rasterDirtRoad(links(mask), atlas, 'trail'));
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) {
      for (let i = 0; i < 32; i++) {
        if ((a & 2) && (b & 8)) expect(pixel(rasters[a], 31, i)).toEqual(pixel(rasters[b], 0, i));
        if ((a & 4) && (b & 1)) expect(pixel(rasters[a], i, 31)).toEqual(pixel(rasters[b], i, 0));
      }
    }
  });

  it('retains an opaque connection at each requested cardinal or diagonal exit', () => {
    for (let mask = 0; mask < 256; mask++) {
      // Check independent exits; a redundant diagonal alongside a cardinal
      // branch shares that cardinal seam rather than owning a corner port.
      if (!exposedExits(mask)) continue;
      const trail = rasterDirtRoad(links(mask), atlas, 'trail');
      for (let i = 0; i < 8; i++) if (mask & 1 << i)
        expect(pixel(trail, exits[i][0], exits[i][1])[3]).toBe(255);
    }
  });

  it('keeps a matching three-pixel seam band for every variant, including diagonal corners', () => {
    for (let mask = 0; mask < 256; mask++) {
      const expected = border(rasterDirtRoad(links(mask), atlas, 'trail'));
      for (let variant = 1; variant < TRAIL_ART_VARIANTS; variant++)
        expect(border(rasterDirtRoad(links(mask), atlas, 'trail', variant)).every((value, i) => value === expected[i]),
          `mask ${mask}, variant ${variant}`).toBe(true);
    }
  });

  it('keeps every requested exit connected through an opaque trail for all variants', () => {
    for (let mask = 1; mask < 256; mask++) for (let variant = 0; variant < TRAIL_ART_VARIANTS; variant++) {
      if (!exposedExits(mask)) continue;
      const pixels = rasterDirtRoad(links(mask), atlas, 'trail', variant);
      const ports = exits.filter((_, bit) => mask & 1 << bit).map(([x, y]) => y * 32 + x);
      const connected = connectedPixels(pixels, ports[0]);
      expect(ports.every(port => connected.has(port)), `mask ${mask}, variant ${variant}`).toBe(true);
      // Even dead ends retain a visible interior, rather than only their seam.
      expect([...connected].some(cell => cell % 32 > 8 && cell % 32 < 24 && cell > 8 * 32 && cell < 24 * 32)).toBe(true);
    }
  });

  it('varies the actual outline while keeping coordinate selection deterministic and bounded', () => {
    const variants = new Set<number>(), keys = new Set<string>(), shape = links(5);
    for (let y = -10; y < 10; y++) for (let x = -10; x < 10; x++) {
      const variant = trailArtVariant(x, y);
      expect(trailArtVariant(x + .25, y + .75)).toBe(variant);
      expect(variant).toBeGreaterThanOrEqual(0); expect(variant).toBeLessThan(TRAIL_ART_VARIANTS);
      variants.add(variant); keys.add(dirtRoadArtKey(shape, x, y, 'trail'));
    }
    expect(variants.size).toBe(TRAIL_ART_VARIANTS); expect(keys.size).toBe(TRAIL_ART_VARIANTS);
    const outlines = new Set<string>();
    for (const variant of variants) {
      const pixels = rasterDirtRoad(shape, atlas, 'trail', variant);
      expect(rasterDirtRoad(shape, atlas, 'trail', variant)).toEqual(pixels);
      outlines.add(pixels.filter((_, i) => i % 4 === 3).join(','));
      expect(rasterDirtRoad(shape, atlas, 'road', variant)).toEqual(rasterDirtRoad(shape, atlas, 'road'));
    }
    expect(outlines.size).toBeGreaterThanOrEqual(8);
    expect(dirtRoadArtKey(shape, 0, 0)).toBe(dirtRoadArtKey(shape, 9, 21));
  });

  it('uses the coordinate variant in the live building cache for camp trails', () => {
    const trail: Building = { id: 1, kind: 'road', roadStyle: 'trail', faction: 0, x: 0, y: 0, hp: 100, maxHp: 100, capacity: 0 };
    const shape = links(10), variants = new Map<number, string>(), ordinary = new Set<string>();
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const b = { ...trail, x, y }, variant = trailArtVariant(x, y), key = buildingKey(b, 0, '#ffffff', shape);
      if (variants.has(variant)) expect(key).toBe(variants.get(variant));
      variants.set(variant, key);
      ordinary.add(buildingKey({ ...b, roadStyle: undefined }, 0, '#ffffff', shape));
    }
    expect(variants.size).toBe(TRAIL_ART_VARIANTS);
    expect(new Set(variants.values()).size).toBe(TRAIL_ART_VARIANTS);
    expect(ordinary.size).toBe(1);
  });
});
