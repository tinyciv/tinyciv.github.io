import { runtimeArtUrl } from './runtime-art';
import type { Unit } from './types';
import { cannonFireFrame, drawCannonFire } from './cannon-fire-art';

const sheets = new Map<string, HTMLImageElement>();
let loading: Promise<void> | undefined;
export const FIELD_CANNON_FRAME = 16;
export const fieldCannonIconUrl = (): string => `${import.meta.env.BASE_URL}assets/runtime/ui/field-cannon.webp`;
export const foundryIconUrl = (): string => `${import.meta.env.BASE_URL}assets/runtime/ui/foundry.webp`;
export function loadFieldCannonArt(): Promise<void> {
  return loading ??= Promise.all(['idle', 'move', 'foundry'].map(async kind => {
    const image = new Image();
    image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/${kind === 'foundry' ? 'buildings/foundry.png' : `units/field-cannon-simple/${kind}.png`}`);
    await image.decode();
    const frame = kind === 'foundry' ? 32 : FIELD_CANNON_FRAME;
    if (image.naturalHeight !== frame || image.naturalWidth !== (kind === 'move' ? frame * 9 : frame)) throw new Error(`Invalid ${kind} cannon/foundry art`);
    sheets.set(kind, image);
  })).then(() => undefined);
}
export function fieldCannonPose(unit: Unit, time: number): { image?: HTMLImageElement; frame: number; key: string } {
  const fire = cannonFireFrame(unit.fieldCannon?.shotAt, time);
  const kind = fire >= 0 ? 'idle' : unit.moving ? 'move' : 'idle';
  let frame = 0;
  if (kind === 'move') frame = Math.floor(time / .09 + unit.id * .37) % 9;
  return { image: sheets.get(kind), frame, key: `${kind}:${frame}:fire:${fire}` };
}
export function drawFieldCannon(c: CanvasRenderingContext2D, unit: Unit, time: number): void {
  if (unit.inside) return;
  const pose = fieldCannonPose(unit, time); if (!pose.image) return;
  c.save(); c.imageSmoothingEnabled = false; c.translate(16, 16); c.rotate(unit.facing + Math.PI / 2);
  c.drawImage(pose.image, pose.frame * FIELD_CANNON_FRAME, 0, FIELD_CANNON_FRAME, FIELD_CANNON_FRAME, -16, -16, 32, 32); c.restore();
  drawCannonFire(c, unit.fieldCannon?.shotAt, time, unit.facing, 16, 16, 32, 14);
}
export function drawFoundry(c: CanvasRenderingContext2D): void {
  const image = sheets.get('foundry'); if (!image) return;
  c.imageSmoothingEnabled = false; c.drawImage(image, 0, 0, 64, 64);
}
