import { describe, expect, it } from 'vitest';
import { wheatJoinMask } from '../src/game/farm-art';
import { fieldKey } from '../src/game/native-art';
import type { FarmField } from '../src/game/types';
import { punyAtlas } from './puny-atlas.js';

const N = 1, E = 2, S = 4, W = 8, NE = 16;
const plot = (x: number, y: number, overrides: Partial<FarmField> = {}): FarmField => ({
  id: y * 100 + x, camp: y * 100 + x, faction: 0, x, y, planted: true,
  food: 0, nextHarvest: 120, wheatRipe: true, ...overrides,
});
const lookup = (fields: FarmField[]) => (x: number, y: number) => fields.find(field => field.x === x && field.y === y);
const atlas = punyAtlas(new URL('../public/assets/pixelhole-overworld/Wheatfield-Joins.png', import.meta.url));
const approved = punyAtlas(new URL('../public/assets/pixelhole-overworld/Wheatfield-Stages.png', import.meta.url));
const pixel = (sheet: ReturnType<typeof punyAtlas>, x: number, y: number) => [...sheet.data.slice((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4)];
const joinedPixel = (mask: number, x: number, y: number) => pixel(atlas, (mask & 15) * 16 + x, (mask >> 4) * 16 + y);
const outline = [24, 20, 37, 255], front = [254, 174, 52, 255];

describe('approved wheat field art', () => {
  it('keeps an isolated field pixel-identical to the approved original sprite', () => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
      expect(joinedPixel(0, x, y)).toEqual(pixel(approved, 32 + x, y));
  });

  it('removes internal plot edges while preserving the outside stalk edge and orange front face', () => {
    // An interior tile has uninterrupted crop pixels, including every edge.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      expect(joinedPixel(255, x, y)[3]).toBe(255);
      expect(joinedPixel(255, x, y)).not.toEqual(outline);
    }
    // A pair of joined fields has no vertical dividing line between its interiors.
    for (let y = 3; y <= 13; y++) for (const [mask, x] of [[E, 15], [W, 0]]) {
      expect(joinedPixel(mask, x, y)[3]).toBe(255);
      expect(joinedPixel(mask, x, y)).not.toEqual(outline);
    }
    expect(joinedPixel(E, 1, 7)).toEqual(outline);
    expect(joinedPixel(E, 8, 1)).toEqual(outline);
    expect(joinedPixel(E, 8, 13)).toEqual(front);
    expect(joinedPixel(E, 8, 14)).toEqual(outline);
  });

  it('keeps an exposed concave corner rather than filling a missing diagonal plot', () => {
    expect(joinedPixel(N | E, 15, 0)[3]).toBe(0);
    expect(joinedPixel(N | E, 14, 0)).toEqual(outline);
    expect(joinedPixel(N | E, 15, 1)).toEqual(outline);
    expect(joinedPixel(N | E | NE, 15, 0)[3]).toBe(255);
    expect(joinedPixel(N | E | NE, 14, 0)).not.toEqual(outline);
  });
});

describe('connected wheat appearance', () => {
  it.each([0, 1, 2])('joins stage %s while ignoring diagonals until both cardinal neighbors exist', stage => {
    const overrides = { wheatRipe: stage === 2, nextHarvest: stage === 0 ? 150 : 120 };
    const center = plot(2, 2, overrides), north = plot(2, 1, overrides), east = plot(3, 2, overrides), northeast = plot(3, 1, overrides);
    expect(wheatJoinMask(center, 90, lookup([northeast]))).toBe(0);
    expect(wheatJoinMask(center, 90, lookup([north, northeast]))).toBe(N);
    expect(wheatJoinMask(center, 90, lookup([north, east]))).toBe(N | E);
    expect(wheatJoinMask(center, 90, lookup([north, east, northeast]))).toBe(N | E | NE);
  });

  it('keeps other factions, orchards and different stages outside the joined patch', () => {
    const center = plot(2, 2), neighbors = [
      plot(2, 1, { faction: 1 }), plot(3, 2, { orchard: { startedAt: 0, readyAt: 120 } }),
      plot(2, 3, { planted: false }), plot(1, 2, { wheatRipe: false }),
    ];
    expect(wheatJoinMask(center, 90, lookup(neighbors))).toBe(0);
    expect(wheatJoinMask({ ...center, planted: false }, 90, lookup([plot(3, 2)]))).toBe(0);
    expect(wheatJoinMask({ ...center, orchard: { startedAt: 0, readyAt: 120 } }, 90, lookup([plot(3, 2)]))).toBe(0);
    const fallow = plot(2, 2, { planted: false }), fresh = plot(3, 2, { wheatRipe: false, nextHarvest: 150 });
    expect(wheatJoinMask(fallow, 90, lookup([fresh]))).toBe(E);
  });

  it('uses each neighbor’s observed time so fog cannot reveal a changed growth stage', () => {
    const center = plot(2, 2), neighbor = plot(3, 2, { wheatRipe: false });
    expect(wheatJoinMask(center, 120, lookup([neighbor]))).toBe(E);
    expect(wheatJoinMask(center, 120, lookup([neighbor]), () => 60)).toBe(0);
    expect(wheatJoinMask(center, 120, lookup([neighbor]), () => 90)).toBe(0);
    expect(wheatJoinMask(center, 120, lookup([neighbor]), () => 99)).toBe(E);
    expect(wheatJoinMask(center, 120, lookup([neighbor]), () => 120)).toBe(E);
    const green = { ...center, wheatRipe: false };
    expect(wheatJoinMask(green, 90, lookup([neighbor]), () => 90)).toBe(E);
    expect(wheatJoinMask(green, 90, lookup([neighbor]), () => 60)).toBe(0);
  });

  it('separates all three stages and their outside boundaries while sharing identical green pixels', () => {
    const growing = plot(2, 2, { wheatRipe: false }), ripe = plot(3, 2, { food: 1 });
    const keys = [60, 90, 120].map(time => fieldKey(growing, time, E));
    expect(new Set(keys).size).toBe(3);
    for (const time of [60, 90, 120]) expect(fieldKey(growing, time, E)).not.toBe(fieldKey(growing, time, E | S));
    expect(fieldKey(growing, 70, E)).toBe(fieldKey(growing, 90, E));
    expect(fieldKey(growing, 99, E)).toBe(fieldKey(ripe, 90, E));
    expect(fieldKey(growing, 120, E)).toBe(fieldKey(ripe, 90, E));
  });

  it('shares identical crop textures across locations for all three stages', () => {
    const left = plot(1, 1, { wheatRipe: false, nextHarvest: 60 }), right = { ...left, x: 2 };
    expect(fieldKey(left, 0, 255)).toBe(fieldKey(right, 0, 255));
    expect(fieldKey(left, 15, 255)).toBe(fieldKey(right, 15, 255));
    expect(fieldKey(left, 60, 255)).toBe(fieldKey(right, 60, 255));
  });
});

describe('seedling and green crop art', () => {
  const seedlings = punyAtlas(new URL('../public/assets/pixelhole-overworld/Seedling-Wheat-Joins.png', import.meta.url));
  const green = punyAtlas(new URL('../public/assets/pixelhole-overworld/Green-Wheat-Joins.png', import.meta.url));
  const cellPixel = (sheet: typeof seedlings, mask: number, x: number, y: number) => pixel(sheet, (mask & 15) * 16 + x, (mask >> 4) * 16 + y);

  it.each([['seedlings', seedlings], ['green', green]] as const)('fills %s patch interiors and removes their shared dividing edges', (_name, sheet) => {
    expect([sheet.width, sheet.height]).toEqual([256, 256]);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      expect(cellPixel(sheet, 255, x, y)[3]).toBe(255);
      expect(cellPixel(sheet, 255, x, y)).not.toEqual(outline);
    }
    for (let y = 6; y < 12; y++) for (const [mask, x] of [[E, 15], [W, 0]]) {
      expect(cellPixel(sheet, mask, x, y)[3]).toBe(255);
      expect(cellPixel(sheet, mask, x, y)).not.toEqual(outline);
    }
  });

  it('lightens the seedling greens without changing their texture scale', () => {
    const brightness = (rgba: number[]) => rgba[0] * .2126 + rgba[1] * .7152 + rgba[2] * .0722;
    const colors = (sheet: typeof seedlings) => new Map(Array.from({ length: 256 }, (_, i) => {
      const rgba = cellPixel(sheet, 255, i % 16, Math.floor(i / 16));
      return [rgba.join(','), rgba] as const;
    }));
    const early = [...colors(seedlings).values()].sort((a,b) => brightness(a)-brightness(b));
    const growing = [...colors(green).values()].sort((a,b) => brightness(a)-brightness(b));
    expect(early.length).toBe(growing.length);
    early.forEach((rgba, i) => {
      expect(rgba[1]).toBeGreaterThan(rgba[0]);
      expect(brightness(rgba)-brightness(growing[i])).toBeGreaterThan(0);
      expect(brightness(rgba)-brightness(growing[i])).toBeLessThan(25);
    });
  });

  it.each([['seedlings', seedlings], ['green', green]] as const)('preserves missing diagonal corners in %s while joining both cardinal sides', (_name, sheet) => {
    expect(cellPixel(sheet, N | E, 15, 0)[3]).toBe(0);
    expect(cellPixel(sheet, N | E | NE, 15, 0)[3]).toBe(255);
    // Both shared seams remain solid away from the missing corner.
    for (let offset = 4; offset < 12; offset++) {
      expect(cellPixel(sheet, N | E, offset, 0)[3]).toBe(255);
      expect(cellPixel(sheet, N | E, 15, offset)[3]).toBe(255);
      expect(cellPixel(sheet, N | E, offset, 0)).not.toEqual(outline);
      expect(cellPixel(sheet, N | E, 15, offset)).not.toEqual(outline);
    }
  });

  it('grows successively taller while retaining the same dark front-edge baseline', () => {
    const firstOpaqueRow = (sheet: typeof seedlings) => Array.from({ length: 16 }, (_, y) => y)
      .find(y => Array.from({ length: 16 }, (_, x) => cellPixel(sheet, 0, x, y)[3]).some(alpha => alpha > 0))!;
    expect(firstOpaqueRow(seedlings)).toBeGreaterThan(firstOpaqueRow(green));
    expect(firstOpaqueRow(green)).toBeGreaterThan(firstOpaqueRow(atlas));
    expect(cellPixel(seedlings, 0, 8, 14)).toEqual(outline);
    expect(cellPixel(green, 0, 8, 14)).toEqual(outline);
  });
});
