import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { HORSEMAN_NATIVE_SCALE, horsemanBounds, horsemanPose, recolorCavalryPixels } from '../src/game/cavalry-art';
import { punyAtlas } from './puny-atlas';

const cyan = punyAtlas(new URL('../public/assets/miniworld/Horseman-Cyan.png', import.meta.url));
const red = punyAtlas(new URL('../public/assets/miniworld/Horseman-Red.png', import.meta.url));

describe('native Miniworld cavalry artwork', () => {
  it('ships exact recorded native knight sheets and stable crops with CC0 provenance', () => {
    const source = JSON.parse(readFileSync('public/assets/miniworld/Cavalry-source.json', 'utf8'));
    expect(source.license).toBe('CC0-1.0'); expect(source.files).toHaveLength(4);
    for (const record of source.files) {
      expect(createHash('sha256').update(readFileSync(`public/assets/miniworld/${record.file}`)).digest('hex')).toBe(record.sha256);
      const art = punyAtlas(new URL(`../public/assets/miniworld/${record.file}`, import.meta.url));
      expect([art.width, art.height]).toEqual(record.dimensions);
    }
    expect([cyan.width, cyan.height]).toEqual([128, 384]);
  });

  it.each([[0, 3], [Math.PI / 2, 0], [Math.PI, 6], [-Math.PI / 2, 9]])('uses all four native frames of idle, walk and attack for angle%s', (facing, firstRow) => {
    for (const action of [0, 1, 2]) {
      const columns = new Set<number>();
      for (let n = 0; n < 40; n++) {
        const pose = horsemanPose({ id: 0, facing, moving: action === 1, attackTime: action === 2 ? .28 - n / 40 * .28 : 0 }, n / 10);
        expect(pose.rect.slice(1)).toEqual([(firstRow + action) * 32, 32, 32]); columns.add(pose.rect[0]);
        const bounds = horsemanBounds(pose);
        expect(bounds.x + pose.anchor[0] * HORSEMAN_NATIVE_SCALE).toBeCloseTo(16);
        expect(bounds.y + pose.anchor[1] * HORSEMAN_NATIVE_SCALE).toBeCloseTo(27.2);
      }
      expect([...columns].sort((a, b) => a - b)).toEqual([0, 32, 64, 96]);
    }
  });

  it('preserves horse, armor, weapon and alpha pixels while recoloring only native team cloth', () => {
    const result = recolorCavalryPixels(cyan.data, red.data, '#ff1122'); let cloth = 0;
    for (let i = 0; i < result.length; i += 4) {
      expect(result[i + 3]).toBe(cyan.data[i + 3]);
      const team = cyan.data[i + 3] && [0, 1, 2].some(channel => cyan.data[i + channel] !== red.data[i + channel]);
      if (team) { cloth++; expect(result.slice(i, i + 3)).not.toEqual(cyan.data.slice(i, i + 3)); }
      else expect(result.slice(i, i + 4)).toEqual(cyan.data.slice(i, i + 4));
    }
    expect(cloth).toBeGreaterThan(500);
  });
});
