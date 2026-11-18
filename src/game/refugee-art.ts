import { runtimeArtUrl } from './runtime-art';
import type { Unit } from './types';
import { facingOctant } from './unit-sprites';

const FRAME = 16;
const WALK_FRAMES = 4;
const WALK_FPS = 9;
// Native art uses the same draw scale and ground anchor as Puny civilians.
export const REFUGEE_BOUNDS = { x: 4.8, y: 6.9, width: 22.4, height: 22.4 };
let sheet: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadRefugeeArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/units/refugee/walk.png`);
    await image.decode();
    if (image.naturalWidth !== FRAME * (1 + WALK_FRAMES) || image.naturalHeight !== FRAME * 8)
      throw new Error('Invalid refugee sprite sheet.');
    sheet = image;
  })();
}

export const refugeeImage = (): HTMLImageElement | undefined => sheet;

export function refugeeFrame(unit: Pick<Unit, 'id' | 'facing' | 'moving'>, time: number): [number, number, number, number] {
  // Rows are S, SE, E, NE, N, NW, W, SW. Column zero is the idle pose.
  const row = (10 - facingOctant(unit.facing)) % 8;
  const column = unit.moving ? 1 + Math.floor(time * WALK_FPS + unit.id * .37) % WALK_FRAMES : 0;
  return [column * FRAME, row * FRAME, FRAME, FRAME];
}

export function drawRefugee(c: CanvasRenderingContext2D, unit: Unit, time: number): void {
  if (!sheet || unit.inside) return;
  const { x, y, width, height } = REFUGEE_BOUNDS;
  c.drawImage(sheet, ...refugeeFrame(unit, time), x, y, width, height);
}
