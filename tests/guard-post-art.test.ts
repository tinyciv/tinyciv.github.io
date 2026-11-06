import { describe, expect, it } from 'vitest';
import { recolorGuardPostPixels } from '../src/game/guard-post-art';
import { punyAtlas } from './puny-atlas';

const native = punyAtlas(new URL('../public/assets/miniworld/Guard-Post.png', import.meta.url));

describe('native Miniworld guard post', () => {
  it('keeps its 16px footprint and preserves every non-team pixel and alpha value', () => {
    expect([native.width, native.height]).toEqual([16, 16]);
    const result = recolorGuardPostPixels(native.data, '#3988ff');
    const roof = new Set(['226,173,110', '188,139,77', '147,103,77']);
    let changed = 0;
    for (let i = 0; i < native.data.length; i += 4) {
      expect(result[i + 3]).toBe(native.data[i + 3]);
      const rgb = [...native.data.subarray(i, i + 3)];
      if (native.data[i + 3] && roof.has(rgb.join(','))) {
        changed++;
        expect([...result.subarray(i, i + 3)]).not.toEqual(rgb);
      } else expect(result.subarray(i, i + 4)).toEqual(native.data.subarray(i, i + 4));
    }
    expect(changed).toBe(104);
  });

  it('uses different faction roofs without changing the original source pixels', () => {
    const original = new Uint8ClampedArray(native.data);
    const blue = recolorGuardPostPixels(native.data, '#3988ff');
    const red = recolorGuardPostPixels(native.data, '#f34f59');
    expect(blue).not.toEqual(red);
    expect(native.data).toEqual(original);
  });
});
