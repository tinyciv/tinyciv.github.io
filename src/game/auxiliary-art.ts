import { drawPerson, personFrame, facingOctant, factionSheet } from './unit-sprites';
import { drawPuny } from './puny-world';
import type { Unit } from './types';

export interface AuxiliaryWeaponPose {
  kind: 'sword' | 'javelin';
  hand: { x: number; y: number };
  tip: { x: number; y: number };
  behind: boolean;
  attackFrame: number;
}
/** Armed townspeople keep the original unarmored Puny worker body and gait.
 * The worker attack cells contain a tool; our separate sword animation replaces it. */
export function auxiliaryBody(unit: Unit): Unit {
  return { ...unit, kind: 'worker', order: 'follow', armorLevel: 0, cargo: 0, attackTime: 0, marauderLeader: false, marauderPack: undefined };
}
const even = (value: number): number => Math.round(value / 2) * 2;
export function auxiliaryWeaponPose(unit: Unit): AuxiliaryWeaponPose | undefined {
  if (unit.kind !== 'levyInfantry' && unit.kind !== 'skirmisher') return;
  const direction = facingOctant(unit.facing) * Math.PI / 4;
  const right = Math.cos(direction) >= -.01;
  const attackFrame = unit.attackTime > 0 ? Math.min(3, Math.floor((.28 - Math.min(.28, unit.attackTime)) / .07)) : -1;
  const kind = unit.kind === 'levyInfantry' ? 'sword' : 'javelin';
  // A raised blade winds up, cuts toward the target, follows through and recovers.
  // This pose participates in the native atlas key, so resting frames stay cached.
  const turn = right ? 1 : -1;
  const angle = attackFrame < 0 || attackFrame === 3 ? -Math.PI / 2 + turn * .24
    : direction + (kind === 'sword' ? [-1.2, -.1, .75][attackFrame] * turn : [-.5, 0, .25][attackFrame] * turn);
  const hand = { x: right ? 22 : 10, y: 23 + (attackFrame === 2 ? 1 : 0) };
  const length = kind === 'sword' ? 11 : 17;
  return { kind, hand, tip: { x: even(hand.x + Math.cos(angle) * length), y: even(hand.y + Math.sin(angle) * length) },
    behind: Math.sin(direction) < -.3, attackFrame };
}
export function auxiliaryArtKey(unit: Unit, time: number, color: string): string {
  const frame = personFrame(auxiliaryBody(unit), time), weapon = auxiliaryWeaponPose(unit);
  return `auxiliary:${unit.kind}:${frame.row}:${frame.frame}:${weapon?.attackFrame ?? -1}:${color}:${!!unit.inside}`;
}
/** Two-pixel steps match the existing enlarged 16px figures, without smooth vectors. */
function pixelLine(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, width: number, color: string): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2));
  c.fillStyle = color;
  for (let index = 0; index <= steps; index++) {
    const fraction = index / steps;
    c.fillRect(even(x0 + (x1 - x0) * fraction) - width / 2, even(y0 + (y1 - y0) * fraction) - width / 2, width, width);
  }
}
function drawWeapon(c: CanvasRenderingContext2D, pose: AuxiliaryWeaponPose): void {
  const { hand, tip } = pose, dx = tip.x - hand.x, dy = tip.y - hand.y, length = Math.hypot(dx, dy);
  const ux = dx / length, uy = dy / length;
  if (pose.kind === 'javelin') {
    pixelLine(c, hand.x - ux * 4, hand.y - uy * 4, tip.x, tip.y, 2, '#725332');
    // The previous broad arrowhead dwarfed the figure: this is a narrow 2×4 tip.
    pixelLine(c, tip.x - ux * 2, tip.y - uy * 2, tip.x, tip.y, 2, '#c5d2ce');
  } else {
    pixelLine(c, hand.x + ux * 3, hand.y + uy * 3, tip.x, tip.y, 4, '#303b38');
    pixelLine(c, hand.x + ux * 3, hand.y + uy * 3, tip.x, tip.y, 2, '#dce3d0');
    c.fillStyle = '#dce3d0'; c.fillRect(even(tip.x + ux * 2) - 1, even(tip.y + uy * 2) - 1, 2, 2);
    pixelLine(c, hand.x - ux * 3, hand.y - uy * 3, hand.x + ux * 1, hand.y + uy * 1, 2, '#725332');
    pixelLine(c, hand.x + ux * 2 - uy * 3, hand.y + uy * 2 + ux * 3,
      hand.x + ux * 2 + uy * 3, hand.y + uy * 2 - ux * 3, 2, '#bda56d');
  }
  c.fillStyle = '#d6a166'; c.fillRect(even(hand.x) - 1, even(hand.y) - 1, 2, 2);
}
export function drawAuxiliary(c: CanvasRenderingContext2D, unit: Unit, time: number, color: string): void {
  if (unit.inside) return;
  const pose = auxiliaryWeaponPose(unit);
  if (pose?.behind) drawWeapon(c, pose);
  drawPerson(c, auxiliaryBody(unit), time, color);
  if (pose && !pose.behind) drawWeapon(c, pose);
  if (unit.kind === 'supplyCart') {
    const right = Math.cos(facingOctant(unit.facing) * Math.PI / 4) >= -.01, x = right ? 0 : 21;
    drawPuny(c, 146, 501, 12, 10, x, 18, 13, 11);
    c.fillStyle = '#543b26'; c.fillRect(x - 1, 27, 16, 3);
    c.fillRect(right ? x + 10 : x - 5, 20, 8, 2);
    c.fillStyle = '#302923'; c.fillRect(x + 1, 28, 4, 4); c.fillRect(x + 10, 28, 4, 4);
    c.fillStyle = '#b69a65'; c.fillRect(x + 2, 29, 2, 2); c.fillRect(x + 11, 29, 2, 2);
  }
}

const portraits = new Map<string, string>();
/** Selection portraits show the same weapon as the figure, rather than an unarmed worker. */
export function auxiliaryIconUrl(kind: 'levyInfantry' | 'skirmisher', color: string): string {
  const key = `${kind}:${color}`, cached = portraits.get(key); if (cached) return cached;
  if (!factionSheet('worker', color)) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
  const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false; c.translate(8, 4);
  const unit: Unit = { id: 0, kind, faction: 0, x: 0, y: 0, hp: 50, morale: 100, attack: 1, defense: 1,
    speed: 1, range: 1, order: 'hold', moving: false, cooldown: 0, lastCombat: -60, facing: Math.PI / 2, attackTime: 0 };
  drawAuxiliary(c, unit, 0, color);
  const url = canvas.toDataURL(); portraits.set(key, url); return url;
}
