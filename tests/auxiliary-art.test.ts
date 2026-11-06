import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { auxiliaryArtKey, auxiliaryBody, drawAuxiliary } from '../src/game/auxiliary-art';
import { militaryActionIcon } from '../src/ui/military-action-icons';
import { NativeArt, unitKey } from '../src/game/native-art';
import * as combat from '../src/game/combat-effect-art';
import { person } from './helpers/research-income';
import * as people from '../src/game/unit-sprites';

const soldier = () => ({ ...person(1, 'levyInfantry'), facing: 0, attackTime: 0, moving: false });
describe('approved armed civilian artwork', () => {
  it('uses 2A for both guard-post militia and levy infantry, and 1B for skirmishers', () => {
    for (const kind of ['militia', 'levyInfantry', 'skirmisher'] as const) {
      const role = kind === 'skirmisher' ? 'skirmisher' : 'militia';
      expect(people.personFrame({ ...soldier(), kind }, 0)).toEqual({ role, row: 2, frame: 0 });
      const file = readFileSync(`public/assets/puny-world/characters/${people.PUNY_CHARACTERS[role].file}`);
      expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([288, 256]);
    }
    expect(people.personFrame({ ...soldier(), kind: 'warrior' }, 0).role).toBe('warrior');
  });
  it('selects the approved eight views and all four attack poses at the existing timing', () => {
    const unit = soldier();
    expect([Math.PI / 2, Math.PI / 4, 0, -Math.PI / 4, -Math.PI / 2, -3 * Math.PI / 4, Math.PI, 3 * Math.PI / 4]
      .map(facing => people.personFrame({ ...unit, facing }, 0).row)).toEqual([0,1,2,3,4,5,6,7]);
    const frames = [.28, .20, .12, .04].map(attackTime => ({ ...unit, attackTime }));
    expect(frames.map(frame => people.personFrame(frame, 0).frame)).toEqual([5,6,7,8]);
    expect(new Set(frames.map(frame => unitKey(frame, 0, '#c94c4c'))).size).toBe(4);
    expect(unitKey(unit, 0, '#c94c4c')).toBe(auxiliaryArtKey(unit, 0, '#c94c4c'));
    expect(unitKey(unit, 100, '#c94c4c')).toBe(unitKey(unit, 0, '#c94c4c'));
    expect(new Set([0,1,2,3].map(frame => people.personFrame({ ...unit, id: 0, moving: true }, frame / 9).frame))).toEqual(new Set([1,2,3,4]));
  });
  it('draws the approved sheet directly, with no procedural weapon or chest overlay', () => {
    const unit = soldier(), body = vi.spyOn(people, 'drawPerson').mockImplementation(() => {});
    const context = { fillRect: vi.fn() };
    drawAuxiliary(context as unknown as CanvasRenderingContext2D, unit, .5, '#c94c4c');
    expect(body).toHaveBeenCalledWith(context, unit, .5, '#c94c4c');
    expect(context.fillRect).not.toHaveBeenCalled();
    body.mockRestore();
  });
  it('uses the approved sheet directly in Pixi, including the same frame for damage flashes', () => {
    const sheet = {} as HTMLCanvasElement, mask = {} as HTMLCanvasElement;
    const palette = vi.spyOn(people, 'factionSheet').mockReturnValue(sheet);
    const damage = vi.spyOn(combat, 'damageMaskSheet').mockReturnValue(mask);
    const image = vi.fn(() => ({ texture: null })), paint = vi.fn();
    const art = Object.assign(Object.create(NativeArt.prototype), { image, paint }) as NativeArt;
    try {
      for (const kind of ['militia', 'levyInfantry', 'skirmisher'] as const) {
        const unit = { ...soldier(), kind, facing: 0, attackTime: .28 };
        art.unit(unit, 0, '#c94c4c');
        expect(palette).toHaveBeenLastCalledWith(kind === 'skirmisher' ? 'skirmisher' : 'militia', '#c94c4c', undefined);
        expect(image).toHaveBeenLastCalledWith(sheet, [160, 64, 32, 32], { x: -6.4, y: -4.44, width: 44.8, height: 44.8 });
        art.unit(unit, 0, '#c94c4c', { damageMask: true });
        expect(damage).toHaveBeenLastCalledWith(sheet);
        expect(image).toHaveBeenLastCalledWith(mask, [160, 64, 32, 32], { x: -6.4, y: -4.44, width: 44.8, height: 44.8 });
      }
      expect(paint).not.toHaveBeenCalled();
    } finally { palette.mockRestore(); damage.mockRestore(); }
  });
  it('recolors only native cloth shades, retaining the bronze, wood, skin, outline and transparency', () => {
    const pixels = new Uint8ClampedArray([0,121,102,255, 0,79,67,255, 246,169,84,255, 102,68,33,255, 4,4,4,255, 0,121,102,0]);
    people.recolorCharacterCloth(pixels, '#c86432');
    expect([...pixels]).toEqual([156,78,39,255, 104,52,26,255, 246,169,84,255, 102,68,33,255, 4,4,4,255, 0,121,102,0]);
  });
  it('retains unarmed worker behavior for supply-cart drivers', () => {
    const unit = { ...soldier(), kind: 'supplyCart' as const, armorLevel: 6 as const, marauderPack: 2 };
    expect(auxiliaryBody(unit)).toMatchObject({ kind: 'worker', armorLevel: 0, order: 'follow', cargo: 0, attackTime: 0 });
    expect(auxiliaryBody(unit).marauderPack).toBeUndefined();
    expect(unit.kind).toBe('supplyCart'); expect(unit.armorLevel).toBe(6);
  });
  it('provides dedicated faction-colored garrison and three-person levy emblems', () => {
    const garrison = militaryActionIcon('garrison', '#c94c4c'), levy = militaryActionIcon('levy', '#c94c4c');
    expect(garrison).toContain('garrison-action-icon'); expect(garrison).toContain('#c94c4c');
    expect(levy.match(/<g transform/g)).toHaveLength(3); expect(levy).toContain('levy-action-icon');
    expect(levy).not.toBe(garrison);
    expect(militaryActionIcon('levy', '\" onload=\"attack()')).not.toContain('onload');
  });
});
