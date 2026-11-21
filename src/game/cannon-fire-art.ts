import { runtimeArtUrl } from './runtime-art';
/** User-selected PixelLab 1C: a brief ignition and black-powder plume.
 * Kept separate from the gun so every authored barrel/wheel pixel stays fixed. */
export const CANNON_FIRE_FRAME_SIZE = 32;
export const CANNON_FIRE_FRAME_COUNT = 9;
export const CANNON_FIRE_FRAME_SECONDS = .09;
export const CANNON_FIRE_SECONDS = CANNON_FIRE_FRAME_COUNT * CANNON_FIRE_FRAME_SECONDS;
const ORIGIN = { x: 16, y: 25 };
const SMOKE_VARIANTS = 3;
const SMOKE_WIDTH = 18;
const SMOKE_HEIGHT = 19;
let image: HTMLImageElement | undefined;
let smokeSheet: HTMLCanvasElement | undefined;
let loading: Promise<void> | undefined;

export function loadCannonFireArt(): Promise<void> {
  return loading ??= (async () => {
    const sheet = new Image();
    sheet.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/effects/cannon-fire/black-powder.png`);
    await sheet.decode();
    if (sheet.naturalWidth !== CANNON_FIRE_FRAME_SIZE * CANNON_FIRE_FRAME_COUNT || sheet.naturalHeight !== CANNON_FIRE_FRAME_SIZE)
      throw new Error('Invalid black-powder cannon firing artwork');
    image = sheet;
  })();
}

export const cannonFireImage = (): HTMLImageElement | undefined => image;

export function gunSmokeFrame(variant: number) {
  if (!image) return;
  if (!smokeSheet) {
    const sheet = document.createElement('canvas');
    sheet.width = SMOKE_VARIANTS * SMOKE_WIDTH;
    sheet.height = SMOKE_HEIGHT;
    const context = sheet.getContext('2d')!;
    for (let i = 0; i < SMOKE_VARIANTS; i++) {
      const frame = CANNON_FIRE_FRAME_COUNT - SMOKE_VARIANTS + i;
      context.drawImage(image, frame * CANNON_FIRE_FRAME_SIZE + 6, 3, SMOKE_WIDTH, SMOKE_HEIGHT,
        i * SMOKE_WIDTH, 0, SMOKE_WIDTH, SMOKE_HEIGHT);
    }
    context.globalCompositeOperation = 'source-atop';
    context.fillStyle = 'rgba(255, 255, 255, 0.18)';
    context.fillRect(0, 0, sheet.width, sheet.height);
    smokeSheet = sheet;
  }
  const rect: [number, number, number, number] = [variant * SMOKE_WIDTH, 0, SMOKE_WIDTH, SMOKE_HEIGHT];
  return { image: smokeSheet, rect };
}

/** Presentation interpolation only; the simulation owns every shot time. */
export function cannonFireFrame(shotAt: number | undefined, time: number): number {
  const age = time - (shotAt ?? -Infinity);
  return !Number.isFinite(age) || age < 0 || age >= CANNON_FIRE_SECONDS ? -1
    : Math.min(CANNON_FIRE_FRAME_COUNT - 1, Math.floor((age + 1e-7) / CANNON_FIRE_FRAME_SECONDS));
}

export function cannonFireStamp(shotAt: number | undefined, time: number, facing: number,
  centerX: number, centerY: number, size: number, muzzleDistance: number) {
  const frame = cannonFireFrame(shotAt, time);
  if (!image || frame < 0) return;
  const scale = size / 16;
  return { image, frame, bounds: { x: centerX - ORIGIN.x * scale, y: centerY - muzzleDistance - ORIGIN.y * scale,
    width: CANNON_FIRE_FRAME_SIZE * scale, height: CANNON_FIRE_FRAME_SIZE * scale },
    rotation: facing + Math.PI / 2, rotationPivot: { x: centerX, y: centerY } };
}

export function drawCannonFire(c: CanvasRenderingContext2D, shotAt: number | undefined, time: number, facing: number,
  centerX: number, centerY: number, size: number, muzzleDistance: number): void {
  const stamp = cannonFireStamp(shotAt, time, facing, centerX, centerY, size, muzzleDistance);
  if (!stamp) return;
  c.save(); c.imageSmoothingEnabled = false; c.translate(centerX, centerY); c.rotate(stamp.rotation);
  c.drawImage(stamp.image, stamp.frame * CANNON_FIRE_FRAME_SIZE, 0, CANNON_FIRE_FRAME_SIZE, CANNON_FIRE_FRAME_SIZE,
    stamp.bounds.x - centerX, stamp.bounds.y - centerY, stamp.bounds.width, stamp.bounds.height);
  c.restore();
}
