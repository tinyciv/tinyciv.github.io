import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as wildlifeArt from '../src/game/wildlife-art';
import { NativeArt, unitKey, type BakedArt } from '../src/game/native-art';
import { drawUnit } from '../src/game/sprites';
import type { Unit } from '../src/game/types';
import { punyAtlas } from './puny-atlas.js';

const bird = (changes: Partial<Unit> = {}): Unit => ({ id: 4, kind: 'marshBird', faction: -3, x: 4.5, y: 4.5,
  hp: 8, maxHp: 8, morale: 100, attack: 0, defense: 0, speed: .55, range: 0, order: 'wander', cooldown: 0,
  lastCombat: -60, moving: false, facing: 0, attackTime: 0, ...changes });

describe('native marsh bird artwork', () => {
  it('changes only the two original red colors throughout all 16 animation cells', () => {
    const path = new URL('../public/assets/miniworld/Chicken.png', import.meta.url);
    expect(createHash('sha256').update(readFileSync(path)).digest('hex'))
      .toBe('473d946ba3bede660b2b0ec1d6263f9aae6b91bb114c3625a84b8d9cd1097483');
    const original = punyAtlas(path), recolored = new Uint8ClampedArray(original.data);
    expect([original.width, original.height]).toEqual([64, 64]);
    wildlifeArt.recolorMarshBird(recolored);
    const changedPerColor = [0, 0], changedCells = new Set<number>();
    for (let i = 0; i < original.data.length; i += 4) {
      const source = original.data.slice(i, i + 4), result = recolored.slice(i, i + 4);
      const color = wildlifeArt.MARSH_BIRD_PALETTE.findIndex(({ from }) => source[3] && from.every((value, channel) => value === source[channel]));
      if (color < 0) expect(result).toEqual(source);
      else {
        expect([...result]).toEqual([...wildlifeArt.MARSH_BIRD_PALETTE[color].to, source[3]]);
        changedPerColor[color]++;
        const pixel = i / 4;
        changedCells.add(Math.floor(pixel / 64 / 16) * 4 + Math.floor(pixel % 64 / 16));
      }
    }
    expect(changedPerColor).toEqual([32, 24]);
    expect(changedCells.size).toBe(16);
  });

  it('keeps four directional animations in bounds with species-specific cache keys', () => {
    for (const [facing, row] of [[Math.PI / 2, 0], [-Math.PI / 2, 1], [0, 3], [Math.PI, 2]]) {
      const unit = bird({ facing });
      expect(wildlifeArt.wildlifeFrame(unit, 0)).toEqual({ row, frame: 0 });
      unit.moving = true;
      const seen = new Set<number>();
      for (let t = 0; t < 1; t += .02) {
        const pose = wildlifeArt.wildlifeFrame(unit, t); seen.add(pose.frame);
        expect(pose.row).toBe(row); expect(pose.frame).toBeGreaterThanOrEqual(0); expect(pose.frame).toBeLessThan(4);
        expect(unitKey(unit, t, '#fff')).not.toBe(unitKey({ ...unit, kind: 'boar' }, t, '#fff'));
      }
      expect(seen.size).toBe(4);
    }
    // Read the actual yellow beak pixels, so a shared boar row assumption
    // cannot make an eastbound bird moonwalk west (the sheets differ).
    const atlas = punyAtlas(new URL('../public/assets/miniworld/Chicken.png', import.meta.url));
    for (const facing of [0, Math.PI]) {
      const { row } = wildlifeArt.wildlifeFrame(bird({ facing }), 0), beakX: number[] = [];
      for (let y = 4; y < 11; y++) for (let x = 0; x < 16; x++) {
        const pixel = ((row * 16 + y) * atlas.width + x) * 4;
        if (atlas.data[pixel] === 231 && atlas.data[pixel + 1] === 181 && atlas.data[pixel + 2] === 39) beakX.push(x);
      }
      expect(beakX.length).toBeGreaterThan(0);
      const meanX = beakX.reduce((sum, x) => sum + x, 0) / beakX.length;
      expect(facing === 0 ? meanX > 8 : meanX < 7).toBe(true);
    }
  });

  it('uses the bird sheet at native scale in both rendering paths', () => {
    const sheet = {} as HTMLCanvasElement, unit = bird(), art = new NativeArt();
    const image = vi.spyOn(wildlifeArt, 'wildlifeImage').mockReturnValue(sheet);
    const drawWildlife = vi.spyOn(wildlifeArt, 'drawWildlife').mockImplementation(() => {});
    const drawNative = vi.spyOn(art as unknown as { image: (...args: unknown[]) => BakedArt }, 'image')
      .mockReturnValue({} as BakedArt);
    try {
      art.unit(unit, 0, '#fff');
      expect(image).toHaveBeenCalledWith('marshBird');
      expect(drawNative).toHaveBeenCalledWith(sheet, [0, 48, 16, 16], { x: 0, y: 0, width: 32, height: 32 });
      const context = { save() {}, restore() {}, translate() {}, scale() {}, imageSmoothingEnabled: true } as unknown as CanvasRenderingContext2D;
      drawUnit(context, unit, 0, 0, 32, 0, '#fff');
      expect(drawWildlife).toHaveBeenCalledWith(context, unit, 0);
    } finally { image.mockRestore(); drawWildlife.mockRestore(); drawNative.mockRestore(); }
  });
});
