import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as carts from '../src/game/handcart-art';
import * as combat from '../src/game/combat-effect-art';
import { NativeArt, unitKey } from '../src/game/native-art';
import { person } from './helpers/research-income';

describe('approved supply handcart movement', () => {
  it('ships four directions of eight native 48px movement frames', () => {
    const png = readFileSync('public/assets/puny-world/characters/Supply-Handcart.png');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([384, 192]);
  });
  it('selects movement frames in every direction and holds the idle pose', () => {
    for (const [facing, row] of [[Math.PI / 2, 0], [0, 1], [Math.PI, 2], [-Math.PI / 2, 3]]) {
      const u = { ...person(0, 'supplyCart'), id: 0, facing, moving: true };
      const keys = new Set<string>();
      for (let f = 0; f < 8; f++) {
        const pose = carts.handcartPose(u, (f + .1) / 8);
        expect(pose.rect).toEqual([f * 48, row * 48, 48, 48]);
        keys.add(unitKey(u, (f + .1) / 8, '#c94c4c'));
        expect(carts.handcartPose({ ...u, moving: false }, f).frame).toBe(0);
      }
      expect(keys.size).toBe(8);
    }
  });
  it('uses unclipped full-sheet bounds for normal and damage rendering', () => {
    const sheet = {} as HTMLCanvasElement, mask = {} as HTMLCanvasElement;
    const palette = vi.spyOn(carts, 'handcartSheet').mockReturnValue(sheet);
    const damage = vi.spyOn(combat, 'damageMaskSheet').mockReturnValue(mask);
    const image = vi.fn(() => ({ texture: null })), paint = vi.fn();
    const art = Object.assign(Object.create(NativeArt.prototype), { image, paint }) as NativeArt;
    const u = { ...person(1, 'supplyCart'), facing: 0, moving: true };
    try {
      const pose = carts.handcartPose(u, .3);
      art.unit(u, .3, '#c94c4c');
      expect(image).toHaveBeenLastCalledWith(sheet, pose.rect, pose.bounds);
      art.unit(u, .3, '#c94c4c', { damageMask: true });
      expect(image).toHaveBeenLastCalledWith(mask, pose.rect, pose.bounds);
      expect(paint).not.toHaveBeenCalled();
    } finally { palette.mockRestore(); damage.mockRestore(); }
  });
});
