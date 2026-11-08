import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORT_ROOF_RECT, FORT_SPRITE, recolorFortPixels } from '../src/game/fort-art';
import { buildingKey } from '../src/game/native-art';
import type { Building } from '../src/game/types';
import provenance from '../public/assets/buildings/fort-source.json';
import { punyAtlas } from './puny-atlas';

const url = new URL('../public/assets/buildings/fort.png', import.meta.url), source = punyAtlas(url);

describe('Fort faction roofs', () => {
  it('keeps the selected source image and its original ground anchor', () => {
    expect(createHash('sha256').update(readFileSync(url)).digest('hex')).toBe(provenance.sha256);
    expect([source.width, source.height]).toEqual([FORT_SPRITE.width, FORT_SPRITE.height]);
    expect(FORT_SPRITE.groundAnchor).toEqual([628, 1130]);
  });

  it.each(['#e84040', '#3988ff', '#44c477', '#ffffff'])('colors only blue roof pixels for faction %s', color => {
    const before = new Uint8ClampedArray(source.data), result = recolorFortPixels(source, color);
    const [left, top, width, height] = FORT_ROOF_RECT;
    let changed = 0, changedElsewhere = 0, changedAlpha = 0;
    const shades = new Set<string>();
    for (let pixel = 0; pixel < source.width * source.height; pixel++) {
      const offset = pixel * 4, x = pixel % source.width, y = Math.floor(pixel / source.width);
      const different = [0, 1, 2].some(channel => result.data[offset + channel] !== source.data[offset + channel]);
      if (result.data[offset + 3] !== source.data[offset + 3]) changedAlpha++;
      if (!different) continue;
      changed++;
      if (x < left || y < top || x >= left + width || y >= top + height
        || source.data[offset + 2] < source.data[offset] + 8 || source.data[offset + 2] < source.data[offset + 1] + 5) changedElsewhere++;
      shades.add([...result.data.subarray(offset, offset + 3)].join(','));
    }
    expect(changed).toBeGreaterThan(40000);
    expect(changedElsewhere).toBe(0); expect(changedAlpha).toBe(0);
    expect(shades.size).toBeGreaterThan(8);
    expect(Buffer.from(source.data).equals(Buffer.from(before))).toBe(true);
    const center = (380 * source.width + 600) * 4, roof = [...result.data.subarray(center, center + 3)];
    if (color === '#e84040') expect(roof[0]).toBeGreaterThan(roof[1] * 2);
    if (color === '#44c477') expect(roof[1]).toBeGreaterThan(roof[0] * 2);
    if (color === '#ffffff') expect(new Set(roof).size).toBe(1);
  });

  it('keys cached Fort artwork by faction so ownership changes update the roof', () => {
    const fort = { id: 1, kind: 'fort', faction: 0, x: 0, y: 0, hp: 2250, maxHp: 2250, capacity: 0 } as Building;
    expect(buildingKey(fort, 0, '#e84040')).not.toBe(buildingKey(fort, 0, '#3988ff'));
  });
});
