import { drawPerson, personFrame, factionSheet } from './unit-sprites';
import { drawHandcart, handcartPose } from './handcart-art';
import type { Unit } from './types';

/** Supply-cart drivers retain the ordinary unarmored worker gait. */
export function auxiliaryBody(unit: Unit): Unit {
  return { ...unit, kind: 'worker', order: 'follow', armorLevel: 0, cargo: 0, attackTime: 0, marauderLeader: false, marauderPack: undefined };
}
export function auxiliaryArtKey(unit: Unit, time: number, color: string): string {
  if (unit.kind === 'supplyCart') {
    const pose = handcartPose(unit, time);
    return `handcart:${pose.row}:${pose.frame}:${color}:${!!unit.inside}`;
  }
  const frame = personFrame(unit, time);
  return `auxiliary:${unit.kind}:${frame.row}:${frame.frame}:${color}:${!!unit.inside}`;
}
export function drawAuxiliary(c: CanvasRenderingContext2D, unit: Unit, time: number, color: string): void {
  if (unit.inside) return;
  if (unit.kind === 'supplyCart') { drawHandcart(c, unit, time, color); return; }
  drawPerson(c, unit, time, color);
}

const portraits = new Map<string, string>();
/** Selection portraits show the same weapon as the figure, rather than an unarmed worker. */
export function auxiliaryIconUrl(kind: 'levyInfantry' | 'skirmisher', color: string): string {
  const key = `${kind}:${color}`, cached = portraits.get(key); if (cached) return cached;
  if (!factionSheet(kind === 'levyInfantry' ? 'militia' : 'skirmisher', color)) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
  const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false; c.translate(8, 4);
  const unit: Unit = { id: 0, kind, faction: 0, x: 0, y: 0, hp: 50, morale: 100, attack: 1, defense: 1,
    speed: 1, range: 1, order: 'hold', moving: false, cooldown: 0, lastCombat: -60, facing: Math.PI / 2, attackTime: 0 };
  drawAuxiliary(c, unit, 0, color);
  const url = canvas.toDataURL(); portraits.set(key, url); return url;
}
