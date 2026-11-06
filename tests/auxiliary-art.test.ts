import { describe, expect, it, vi } from 'vitest';
import { auxiliaryArtKey, auxiliaryBody, auxiliaryWeaponPose, drawAuxiliary } from '../src/game/auxiliary-art';
import { militaryActionIcon } from '../src/ui/military-action-icons';
import { unitKey } from '../src/game/native-art';
import { person } from './helpers/research-income';
import * as people from '../src/game/unit-sprites';

const soldier = () => ({ ...person(1, 'levyInfantry'), facing: 0, attackTime: 0, moving: false });
describe('armed civilian artwork', () => {
  it('retains the unarmored peasant body and uses a short sword for levy infantry', () => {
    const unit = { ...soldier(), armorLevel: 6 as const, marauderPack: 2 };
    expect(auxiliaryBody(unit)).toMatchObject({ kind: 'worker', armorLevel: 0, order: 'follow', cargo: 0, attackTime: 0 });
    expect(auxiliaryBody(unit).marauderPack).toBeUndefined();
    const pose = auxiliaryWeaponPose(unit)!;
    expect(pose.kind).toBe('sword'); expect(Math.hypot(pose.tip.x - pose.hand.x, pose.tip.y - pose.hand.y)).toBeLessThan(13);
    expect(unit.kind).toBe('levyInfantry'); expect(unit.armorLevel).toBe(6);
  });
  it('animates four sword attack phases and includes every phase in the shared Pixi cache key', () => {
    const unit = soldier(), frames = [.28, .20, .12, .04].map(attackTime => ({ ...unit, attackTime }));
    expect(frames.map(frame => auxiliaryWeaponPose(frame)!.attackFrame)).toEqual([0,1,2,3]);
    expect(new Set(frames.map(frame => unitKey(frame, 0, '#c94c4c'))).size).toBe(4);
    expect(new Set(frames.map(frame => JSON.stringify(auxiliaryWeaponPose(frame)!.tip))).size).toBeGreaterThanOrEqual(3);
    expect(auxiliaryWeaponPose(frames[1])!.tip.x).toBeGreaterThan(auxiliaryWeaponPose(frames[0])!.tip.x);
    expect(unitKey(unit, 0, '#c94c4c')).toBe(auxiliaryArtKey(unit, 0, '#c94c4c'));
    expect(unitKey(unit, 100, '#c94c4c')).toBe(unitKey(unit, 0, '#c94c4c'));
  });
  it('draws only a two-pixel-wide javelin tip while retaining the slender shaft', () => {
    const unit = { ...soldier(), kind: 'skirmisher' as const }, pixels: { color: string; width: number; height: number }[] = [];
    const context = { fillStyle: '', fillRect(_x: number, _y: number, width: number, height: number) { pixels.push({ color: this.fillStyle, width, height }); } };
    const body = vi.spyOn(people, 'drawPerson').mockImplementation(() => {});
    drawAuxiliary(context as unknown as CanvasRenderingContext2D, unit, 0, '#c94c4c'); body.mockRestore();
    const tip = pixels.filter(pixel => pixel.color === '#c5d2ce');
    expect(tip.length).toBeGreaterThan(0); expect(tip.every(pixel => pixel.width === 2 && pixel.height === 2)).toBe(true);
  });
  it('renders north-facing weapons behind the body, with mirrored hand placement to the west', () => {
    expect(auxiliaryWeaponPose({ ...soldier(), facing: -Math.PI / 2 })!.behind).toBe(true);
    expect(auxiliaryWeaponPose({ ...soldier(), facing: Math.PI / 2 })!.behind).toBe(false);
    expect(auxiliaryWeaponPose({ ...soldier(), facing: Math.PI })!.hand.x).toBeLessThan(auxiliaryWeaponPose(soldier())!.hand.x);
  });
  it('provides dedicated faction-colored garrison and three-person levy emblems', () => {
    const garrison = militaryActionIcon('garrison', '#c94c4c'), levy = militaryActionIcon('levy', '#c94c4c');
    expect(garrison).toContain('garrison-action-icon'); expect(garrison).toContain('#c94c4c');
    expect(levy.match(/<g transform/g)).toHaveLength(3); expect(levy).toContain('levy-action-icon');
    expect(levy).not.toBe(garrison);
    expect(militaryActionIcon('levy', '\" onload=\"attack()')).not.toContain('onload');
  });
});
