import { describe, expect, it } from 'vitest';
import { NATIVE_BUILDINGS, nativeHouseTier, recolorPunyBuildingPixels, type NativeBuildingRect } from '../src/game/puny-building-art';
import { punyAtlas } from './puny-atlas';

const atlas = punyAtlas();
const nativePixel = (x: number, y: number) => [...atlas.data.subarray((y * atlas.width + x) * 4, (y * atlas.width + x) * 4 + 4)];
const crops: [string, NativeBuildingRect, number][] = [
  ['tent', [64, 416, 16, 16], 184], ['flat roof', [64, 432, 16, 16], 174],
  ['gable roof', [80, 432, 16, 16], 159], ['chimney house', [128, 464, 16, 16], 127], ['narrow well', [80, 480, 16, 16], 56],
  ['palace left building', [192, 416, 16, 32], 218], ['palace right building', [208, 416, 16, 32], 218],
  ['native banner', [164, 444, 5, 4], 18],
];

describe('original Puny building team palettes', () => {
  it.each(crops)('tints only the independently verified variant pixels in %s', (_name, source, expectedMaskCount) => {
    const result = recolorPunyBuildingPixels(atlas, source, '#b843ba');
    const [sx, sy, width, height] = source;
    let permitted = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const gold = nativePixel(sx + x, sy + y), cyan = nativePixel(sx + x, sy + y + 112), red = nativePixel(sx + x + 160, sy + y + 112);
      const i = (y * width + x) * 4, actual = [...result.data.subarray(i, i + 4)];
      const ownsColor = gold[3] > 0 && gold[3] === cyan[3] && gold[3] === red[3]
        && (gold.slice(0, 3).join() !== cyan.slice(0, 3).join() || gold.slice(0, 3).join() !== red.slice(0, 3).join());
      expect(result.teamMask[y * width + x]).toBe(Number(ownsColor));
      expect(actual[3]).toBe(gold[3]);
      if (ownsColor) { permitted++; expect(actual.slice(0, 3)).not.toEqual(gold.slice(0, 3)); }
      else expect(actual).toEqual(gold);
    }
    expect(permitted).toBe(expectedMaskCount);
  });

  it.each(['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#123456'])('keeps ordered native shade steps for %s', color => {
    const source = NATIVE_BUILDINGS.houses[1].rect, output = recolorPunyBuildingPixels(atlas, source, color);
    const byNativeValue = new Map<number, number[]>();
    for (let y = 0; y < source[3]; y++) for (let x = 0; x < source[2]; x++) {
      const pixel = y * source[2] + x;
      if (!output.teamMask[pixel]) continue;
      const native = nativePixel(source[0] + x, source[1] + y + 112);
      const value = Math.max(...native.slice(0, 3)), rgb = [...output.data.subarray(pixel * 4, pixel * 4 + 3)];
      if (byNativeValue.has(value)) expect(rgb).toEqual(byNativeValue.get(value));
      else byNativeValue.set(value, rgb);
    }
    const shades = [...byNativeValue.entries()].sort((a, b) => a[0] - b[0]);
    const lightness = (rgb: number[]) => (Math.max(...rgb) + Math.min(...rgb)) / 2;
    for (let i = 1; i < shades.length; i++) expect(lightness(shades[i][1])).toBeGreaterThanOrEqual(lightness(shades[i - 1][1]));
    expect(new Set(shades.map(([, rgb]) => rgb.join())).size).toBeGreaterThanOrEqual(4);
  });

  it('leaves shared stone and timber materials byte-identical across factions', () => {
    for (const source of [[288, 464, 16, 16], [352, 432, 4, 16], [112, 480, 16, 16]] as NativeBuildingRect[]) {
      const red = recolorPunyBuildingPixels(atlas, source, '#d0362d');
      const blue = recolorPunyBuildingPixels(atlas, source, '#3988ff');
      expect([...red.teamMask]).toEqual(Array(source[2] * source[3]).fill(0));
      expect(red.data).toEqual(blue.data);
      for (let y = 0; y < source[3]; y++) for (let x = 0; x < source[2]; x++) {
        const offset = (y * source[2] + x) * 4;
        expect([...red.data.subarray(offset, offset + 4)]).toEqual(nativePixel(source[0] + x, source[1] + y));
      }
    }
  });

  it('normalizes shorthand team colors and rejects invalid source rectangles', () => {
    const source = NATIVE_BUILDINGS.well.rect;
    expect(recolorPunyBuildingPixels(atlas, source, '#0af').data).toEqual(recolorPunyBuildingPixels(atlas, source, '#00aaff').data);
    expect(recolorPunyBuildingPixels(atlas, source, 'invalid').data).toEqual(recolorPunyBuildingPixels(atlas, source, '#3988ff').data);
    expect(() => recolorPunyBuildingPixels(atlas, [430, 0, 16, 16], '#00aaff')).toThrow(RangeError);
  });

  it('maps all recorded upgrades to the four native pictures without mutating gameplay levels', () => {
    for (const [level, expected] of [[1, 1], [2, 2], [3, 3], [4, 4], [99, 4], [0, 1], [2.9, 2]]) {
      const building = { houseLevel: level, houseStyle: 'villa' as const };
      expect(nativeHouseTier(building)).toBe(expected); expect(building.houseLevel).toBe(level);
    }
    expect(nativeHouseTier({})).toBe(1);
    expect(nativeHouseTier({ houseStyle: 'hovel' })).toBe(2);
    expect(nativeHouseTier({ houseStyle: 'villa' })).toBe(4);
    expect(nativeHouseTier({ houseLevel: Number.NaN, houseStyle: 'cottage' })).toBe(3);
  });
});
