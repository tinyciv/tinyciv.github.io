import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ballistaFrame, ballistaIconUrl, drawBallista, drawBallistaBolt, drawSpearman, loadSiegeArt,
  recolorSpearmanPixels, spearmanBounds, spearmanIconUrl, spearmanPose, spearmanSheet } from '../src/game/siege-art';
import { NativeArt, buildingKey, unitKey, type BakedArt } from '../src/game/native-art';
import { drawUnit, drawBuilding } from '../src/game/sprites';
import type { Building, Unit } from '../src/game/types';
import { punyAtlas } from './puny-atlas';

const native = punyAtlas(new URL('../public/assets/miniworld/Spearman-Cyan.png', import.meta.url));
const red = punyAtlas(new URL('../public/assets/miniworld/Spearman-Red.png', import.meta.url));
const unit = (facing = 0, attackTime = 0): Unit => ({ id: 1, kind: 'spearman', faction: 0, x: 4, y: 4, hp: 100, maxHp: 100,
  attack: 17, defense: 6, speed: 3, range: 1.4, morale: 100, order: 'follow', facing, attackTime, moving: false,
  cooldown: 0, lastCombat: -60 });
const building: Building = { id: 2, kind: 'ballista', faction: 0, x: 5, y: 5, hp: 200, maxHp: 200, capacity: 0 };
class Drawing {
  imageSmoothingEnabled = true;
  draws: unknown[][] = [];
  source?: { src: string };
  save() {} restore() {} translate() {} scale() {}
  drawImage(...args: unknown[]) { this.draws.push(args); this.source = args[0] as { src: string }; }
  createImageData(width: number, height: number) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
  getImageData() { return this.source?.src.includes('Red') ? red : native; }
  putImageData() {}
}
beforeAll(async () => {
  vi.stubGlobal('Image', class {
    src = '';
    get naturalWidth() { return this.src.includes('Spearman') ? 80 : this.src.includes('Bolt') ? 32 : 112; }
    get naturalHeight() { return this.src.includes('Spearman') ? 224 : this.src.includes('Bolt') ? 16 : 64; }
    async decode() {}
  });
  vi.stubGlobal('document', { createElement: () => { const context = new Drawing(); return { width: 0, height: 0,
    getContext: () => context, toDataURL: () => 'data:image/png;base64,native-preview' }; } });
  await loadSiegeArt();
});
afterAll(() => vi.unstubAllGlobals());

describe('native Miniworld ballista and spearmen', () => {
  it('ships exact source sheets with recorded CC0 provenance', () => {
    const source = JSON.parse(readFileSync('public/assets/miniworld/Siege-Spearmen-source.json', 'utf8'));
    expect(source.license).toBe('CC0-1.0');
    for (const record of source.files) {
      const file = readFileSync(`public/assets/miniworld/${record.file}`);
      expect(createHash('sha256').update(file).digest('hex')).toBe(record.sha256);
    }
    expect([native.width, native.height]).toEqual([80, 224]);
  });

  it('tints only the source faction cloth, preserving every weapon, armor, shield and alpha pixel', () => {
    const result = recolorSpearmanPixels(native.data, red.data, '#ee3434');
    let changed = 0;
    for (let i = 0; i < result.length; i += 4) {
      expect(result[i + 3]).toBe(native.data[i + 3]);
      const cloth = native.data[i + 3] && [0, 1, 2].some(channel => native.data[i + channel] !== red.data[i + channel]);
      if (cloth) { changed++; expect(result.slice(i, i + 3)).not.toEqual(native.data.slice(i, i + 3)); }
      else expect(result.slice(i, i + 4)).toEqual(native.data.slice(i, i + 4));
    }
    expect(changed).toBeGreaterThan(500);
  });

  it.each([[0, 3], [Math.PI / 2, 0], [Math.PI, 2], [-Math.PI / 2, 1]])('uses the native walking direction for angle%s', (facing, row) => {
    const person = unit(facing); person.moving = true;
    const frames = new Set<number>();
    for (let time = 0; time < 1; time += .03) {
      const pose = spearmanPose(person, time); frames.add(pose.rect[0]);
      expect(pose.rect.slice(1)).toEqual([row * 16, 16, 16]);
      expect(pose.anchor).toEqual([8, 15]);
    }
    expect([...frames].sort((a, b) => a - b)).toEqual([16, 32, 48, 64]);
  });

  it.each([[0, 32, 16, 8, 15], [Math.PI / 2, 16, 32, 8, 15], [Math.PI, 32, 16, 24, 15], [-Math.PI / 2, 16, 32, 8, 31]])
    ('preserves all three extended spear thrusts and a stable foot anchor for angle%s', (facing, width, height, anchorX, anchorY) => {
      const rects = new Set<string>();
      for (const attackTime of [.28, .17, .01]) {
        const pose = spearmanPose(unit(facing, attackTime), 0), bounds = spearmanBounds(pose);
        rects.add(pose.rect.join(','));
        expect(pose.rect.slice(2)).toEqual([width, height]);
        expect(pose.anchor).toEqual([anchorX, anchorY]);
        expect(bounds.x + anchorX * 1.8).toBeCloseTo(16);
        expect(bounds.y + anchorY * 1.8).toBeCloseTo(27.2);
        expect(pose.rect[0] + width).toBeLessThanOrEqual(native.width);
        expect(pose.rect[1] + height).toBeLessThanOrEqual(native.height);
      }
      expect(rects.size).toBe(3);
    });

  it('uses identical native spear frames in Canvas world drawing and Pixi atlas rendering', () => {
    const person = unit(0, .17), context = new Drawing(), pose = spearmanPose(person, 0), bounds = spearmanBounds(pose);
    drawUnit(context as unknown as CanvasRenderingContext2D, person, 0, 0, 32, 0, '#ee3434');
    expect(context.draws).toEqual([[spearmanSheet('#ee3434'), ...pose.rect, bounds.x, bounds.y, bounds.width, bounds.height]]);
    const art = new NativeArt(), image = vi.spyOn(art as unknown as { image: (...args: unknown[]) => BakedArt }, 'image')
      .mockReturnValue({} as BakedArt);
    art.unit(person, 0, '#ee3434');
    expect(image).toHaveBeenCalledWith(spearmanSheet('#ee3434'), pose.rect, bounds);
    expect(unitKey(person, 0, '#ee3434')).not.toContain('empty:');
    expect(unitKey(person, 0, '#ee3434')).not.toBe(unitKey({ ...person, attackTime: 0 }, 0, '#ee3434'));
    const hidden = new Drawing(); drawSpearman(hidden as unknown as CanvasRenderingContext2D, { ...person, inside: true }, 0, '#ee3434');
    expect(hidden.draws).toEqual([]);
  });

  it('orients native ballista rows and caches distinct firing/reload poses', () => {
    for (const [siegeFacing, row] of [[0, 2], [Math.PI / 2, 1], [Math.PI, 3], [-Math.PI / 2, 0]]) {
      const bow = { ...building, siegeFacing, siegeShotAt: 10 };
      expect(ballistaFrame(bow, 9).column).toBe(0);
      const keys = new Set<string>();
      for (const [age, column] of [[0, 3], [.21, 4], [.41, 5], [.61, 6], [.81, 0]]) {
        expect(ballistaFrame(bow, 10 + age)).toEqual({ row, column });
        keys.add(buildingKey(bow, 10 + age, '#ee3434'));
      }
      expect(keys.size).toBe(5);
    }
  });

  it('draws the complete one-cell ballista and native east-facing bolt without replacing source art', () => {
    const c = new Drawing(); drawBuilding(c as unknown as CanvasRenderingContext2D, building, 0, 0, 32, 0, '#ee3434');
    expect(c.draws[0].slice(1)).toEqual([0, 0, 16, 16, 0, 0, 32, 32]);
    const bolt = new Drawing(); drawBallistaBolt(bolt as unknown as CanvasRenderingContext2D, 32);
    expect((bolt.draws[0][0] as { src: string }).src).toContain('BallistaBolt.png');
    expect(bolt.draws[0].slice(1, 5)).toEqual([16, 0, 16, 16]);
    expect(ballistaIconUrl()).toContain('data:image/png');
    expect(spearmanIconUrl()).toContain('data:image/png');
  });
});
