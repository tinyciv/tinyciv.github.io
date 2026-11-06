import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildingKey, NativeArt } from '../src/game/native-art';
import { palaceArtHeight } from '../src/game/palace-sprite';
import { NATIVE_BUILDINGS, recolorPunyBuildingPixels } from '../src/game/puny-building-art';
import { buildingBlockers } from '../src/game/pathfinding';
import type { Building, GameState } from '../src/game/types';
import { recolorWoodenSettlementPixels, WOODEN_SETTLEMENT_ANCHOR, WOODEN_SETTLEMENT_ROOF_PIXELS,
  WOODEN_SETTLEMENT_SIZE } from '../src/game/wooden-settlement-art';
import provenance from '../public/assets/buildings/wooden-settlement-source.json';
import { punyAtlas } from './puny-atlas';

const imageUrl = new URL('../public/assets/buildings/wooden-settlement.png', import.meta.url);
const source = punyAtlas(imageUrl), atlas = punyAtlas();
const roof = new Set(WOODEN_SETTLEMENT_ROOF_PIXELS);
const settlement: Building = { id: 7, kind: 'palace', faction: 0, x: 1, y: 1, hp: 650, maxHp: 650, capacity: 0 };

describe('selected wooden Settlement artwork', () => {
  it('ships the approved 4B geometry with a red roof and original foundation registration', () => {
    expect(createHash('sha256').update(readFileSync(imageUrl)).digest('hex')).toBe(provenance.sourceSha256);
    expect([source.width, source.height]).toEqual(WOODEN_SETTLEMENT_SIZE);
    expect(WOODEN_SETTLEMENT_ANCHOR).toEqual([16, 32]);
    expect([...roof]).toEqual(provenance.roofMask.indices);
    expect(roof.size).toBe(384);
    const occupiedRows = [...source.data].filter((alpha, index) => index % 4 === 3 && alpha > 0);
    expect(occupiedRows.length).toBe(994);
    const nonRoof = source.data.filter((_value, byte) => !roof.has(Math.floor(byte / 4)));
    expect(createHash('sha256').update(nonRoof).digest('hex')).toBe(provenance.nonRoofRgbaSha256);
    // The source roof uses the original atlas red ramp at corresponding keep pixels.
    for (const pixel of roof) {
      const original = ((528 + Math.floor(pixel / 32)) * atlas.width + 352 + pixel % 32) * 4;
      expect(source.data.subarray(pixel * 4, pixel * 4 + 4)).toEqual(atlas.data.subarray(original, original + 4));
    }
  });

  it.each(['#e45454', '#3988ff', '#52a85b', '#000000', '#ffffff'])('changes only the roof RGB for faction %s', color => {
    const before = new Uint8ClampedArray(source.data), result = recolorWoodenSettlementPixels(source, atlas, color);
    const shades = new Set<string>(); let changed = 0;
    const native = recolorPunyBuildingPixels(atlas, NATIVE_BUILDINGS.palace.rect, color);
    for (let pixel = 0; pixel < source.width * source.height; pixel++) {
      const offset = pixel * 4;
      expect(result.data[offset + 3]).toBe(source.data[offset + 3]);
      if (!roof.has(pixel)) expect(result.data.subarray(offset, offset + 4)).toEqual(source.data.subarray(offset, offset + 4));
      else {
        const rgb = result.data.subarray(offset, offset + 3);
        expect(native.teamMask[pixel]).toBe(1);
        expect(rgb).toEqual(native.data.subarray(offset, offset + 3));
        shades.add([...rgb].join(','));
        if (rgb.some((value, channel) => value !== source.data[offset + channel])) changed++;
      }
    }
    expect(changed).toBe(roof.size);
    expect(shades.size).toBeGreaterThanOrEqual(4);
    expect(source.data).toEqual(before);
  });

  it('allocates the native 32px art, keeps the four collision cells, and changes the art cache on upgrade', () => {
    const art = new NativeArt();
    const paint = vi.spyOn(art, 'paint').mockImplementation((_key, bounds) => ({ ...bounds, texture: null! }));
    const wood = art.building(settlement, 0, '#3988ff');
    const keep = { ...settlement, palaceLevel: 2 as const };
    const stone = art.building(keep, 0, '#3988ff');
    expect(wood).toMatchObject({ x: 0, y: 0, width: 64, height: 64 });
    expect(stone).toMatchObject({ x: 0, y: 0, width: 64, height: 64 });
    expect(palaceArtHeight()).toBe(64); expect(palaceArtHeight(2)).toBe(64);
    expect(buildingKey(settlement, 0, '#3988ff')).toBe(buildingKey({ ...settlement, palaceLevel: 1 }, 0, '#3988ff'));
    expect(paint.mock.calls[0][0]).not.toBe(paint.mock.calls[1][0]);
    for (const building of [settlement, keep]) {
      const state = { world: { width: 4 }, buildings: [building] } as unknown as GameState;
      expect([...buildingBlockers(state, 0)]).toEqual([5, 6, 9, 10]);
    }
  });
});
