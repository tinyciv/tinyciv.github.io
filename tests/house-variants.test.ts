import { afterEach, describe, expect, it, vi } from 'vitest';
import { houseVariantPixels, nativeHouseVariant, type HouseVariant, type VariedHouseTier } from '../src/game/house-variant-art';
import { NATIVE_BUILDINGS, recolorPunyBuildingPixels } from '../src/game/puny-building-art';
import { buildingKey } from '../src/game/native-art';
import { drawWoodenHouse } from '../src/game/wooden-building-art';
import * as punyWorld from '../src/game/puny-world';
import type { Building } from '../src/game/types';
import { punyAtlas } from './puny-atlas';

const atlas = punyAtlas();
const house = (id: number, houseLevel = 2): Building => ({
  id, houseLevel, kind: 'house', faction: 0, x: 2, y: 3, hp: 100, maxHp: 100, capacity: 0,
});
const cases: [VariedHouseTier, HouseVariant, string][] = [
  [2, 0, 'flat-roof-a'], [2, 1, 'flat-roof-b'], [3, 0, 'gabled-roof-a'], [3, 1, 'gabled-roof-b'],
];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('approved house variants', () => {
  it.each(cases)('reproduces the approved tier %s variant %s PNG exactly', (tier, variant, name) => {
    // Give the native palette operation three identical red source blocks so
    // it returns the unmodified approved reference colors for this assertion.
    const redAtlas = { ...atlas, data: new Uint8ClampedArray(atlas.data) };
    const [sx, sy] = NATIVE_BUILDINGS.houses[tier].rect;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const red = ((sy + 112 + y) * atlas.width + sx + 160 + x) * 4;
      const rgba = atlas.data.subarray(red, red + 4);
      for (const dy of [0, 112]) redAtlas.data.set(rgba, ((sy + dy + y) * atlas.width + sx + x) * 4);
    }
    const expected = punyAtlas(new URL(`../public/assets/buildings/house-variants/${name}.png`, import.meta.url));
    const actual = houseVariantPixels(redAtlas, tier, variant, '#3988ff');
    expect([actual.width, actual.height]).toEqual([16, 16]);
    expect(actual.data).toEqual(expected.data);
  });

  it.each(cases)('keeps tier %s variant %s materials and silhouette unchanged between factions', (tier, variant, name) => {
    const blue = houseVariantPixels(atlas, tier, variant, '#3988ff');
    const red = houseVariantPixels(atlas, tier, variant, '#e84c3a');
    const original = recolorPunyBuildingPixels(atlas, NATIVE_BUILDINGS.houses[tier].rect, '#3988ff');
    const approved = punyAtlas(new URL(`../public/assets/buildings/house-variants/${name}.png`, import.meta.url));
    let colored = 0;
    for (let pixel = 0; pixel < 256; pixel++) {
      const offset = pixel * 4;
      expect(blue.data[offset + 3]).toBe(original.data[offset + 3]);
      expect(red.data[offset + 3]).toBe(blue.data[offset + 3]);
      if (!blue.teamMask[pixel]) {
        expect(red.data.subarray(offset, offset + 4)).toEqual(blue.data.subarray(offset, offset + 4));
        expect(blue.data.subarray(offset, offset + 4)).toEqual(approved.data.subarray(offset, offset + 4));
      }
      else { colored++; expect(red.data.subarray(offset, offset + 3)).not.toEqual(blue.data.subarray(offset, offset + 3)); }
      if (!original.teamMask[pixel]) expect(blue.teamMask[pixel]).toBe(0);
    }
    expect(colored).toBeGreaterThan(100);
  });

  it.each([
    [2, 0, 3, 12, [35, 28, 28]], // F1 new left window
    [2, 0, 11, 12, [35, 28, 28]], // F1 new right window
    [2, 1, 4, 12, [35, 28, 28]], // F2 left window
    [3, 0, 7, 13, [51, 35, 5]], // G1 dark door
    [3, 0, 11, 12, [35, 28, 28]], // G1 right window
    [3, 1, 3, 12, [35, 28, 28]], // G2 left window
  ] as const)('keeps tier %s variant %s facade pixel (%s, %s) dark for every faction', (tier, variant, x, y, rgb) => {
    for (const faction of ['#3988ff', '#e84c3a', '#ffffff']) {
      const pixels = houseVariantPixels(atlas, tier, variant, faction), index = y * 16 + x;
      expect(pixels.teamMask[index]).toBe(0);
      expect([...pixels.data.subarray(index * 4, index * 4 + 3)]).toEqual(rgb);
    }
  });

  it('uses both variants consistently across rendering, time and ownership, excluding tents and level four', () => {
    const seen = new Set();
    for (let id = 1; id <= 100; id++) {
      const building = house(id), variant = nativeHouseVariant(building);
      seen.add(variant);
      expect(nativeHouseVariant({ ...building, houseLevel: 3 })).toBe(variant);
      expect(nativeHouseVariant({ ...building, faction: 9 } as Building)).toBe(variant);
      expect(buildingKey(building, 0, '#3988ff')).toBe(buildingKey(building, 500, '#3988ff'));
      expect(nativeHouseVariant({ ...building, houseLevel: 1 })).toBeUndefined();
      expect(nativeHouseVariant({ ...building, houseLevel: 4 })).toBeUndefined();
    }
    expect([...seen].sort()).toEqual([0, 1]);
    const a = house(1), b = house(Array.from({ length: 100 }, (_, i) => i + 2).find(id => nativeHouseVariant(house(id)) !== nativeHouseVariant(a))!);
    expect(buildingKey(a, 0, '#3988ff')).not.toBe(buildingKey(b, 0, '#3988ff'));
    expect(buildingKey({ ...a, houseLevel: 1 }, 0, '#3988ff')).toBe(buildingKey({ ...b, houseLevel: 1 }, 0, '#3988ff'));
  });

  it('draws the approved sprite through the game house wrapper at the existing tile size and anchor', () => {
    vi.spyOn(punyWorld, 'punyWorldPixels').mockReturnValue(atlas);
    const context = {
      createImageData: () => ({ data: new Uint8ClampedArray(16 * 16 * 4) }),
      putImageData: vi.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: () => context };
    vi.stubGlobal('document', { createElement: () => canvas });
    const target = { imageSmoothingEnabled: true, drawImage: vi.fn() };
    const building = house(7, 3), color = '#d2aa55';
    drawWoodenHouse(target as unknown as CanvasRenderingContext2D, building, 64, 96, 32, color);
    expect(target.drawImage).toHaveBeenCalledWith(canvas, 64, 96, 32, 32);
    expect([canvas.width, canvas.height]).toEqual([16, 16]);
    expect(target.imageSmoothingEnabled).toBe(false);
    expect(context.putImageData.mock.calls[0][0].data).toEqual(houseVariantPixels(atlas, 3, nativeHouseVariant(building)!, color).data);
  });
});
