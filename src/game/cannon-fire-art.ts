import { runtimeArtUrl } from './runtime-art';
/** User-selected PixelLab 1C: a brief ignition and black-powder plume.
 * Kept separate from the gun so every authored barrel/wheel pixel stays fixed. */
export const CANNON_FIRE_FRAME_SIZE = 32;
export const CANNON_FIRE_FRAME_COUNT = 9;
export const CANNON_FIRE_FRAME_SECONDS = .09;
export const CANNON_FIRE_SECONDS = CANNON_FIRE_FRAME_COUNT * CANNON_FIRE_FRAME_SECONDS;
const ORIGIN = { x: 16, y: 25 };
let image: HTMLImageElement | undefined;
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
