import { runtimeArtUrl } from './runtime-art';
import { loadMaritimeArt } from './maritime-art';
import type { FishingBoat, FishingFish } from './fishing';
import { drawSailboat, loadNavalArt, sailboatMirrored } from './naval-art';
import breach from './fish-breach.json';

let fishSheet: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
const FRAME_COUNT = breach.frameDurationsMs.length;
const FRAME_ENDS: number[] = [];
let surfaceSeconds = 0;
for (const duration of breach.frameDurationsMs) { surfaceSeconds += duration / 1000; FRAME_ENDS.push(surfaceSeconds); }
type FishAppearance = Pick<FishingFish, 'id' | 'facing'> & Partial<Pick<FishingFish, 'spawnedAt'>>;

/** PixelLab breach poses and splashes, packed on the native 16px grid. */
export function loadFishingArt(): Promise<void> {
  return loading ??= Promise.all([loadNavalArt(), loadMaritimeArt(), (async () => {
    const image = new Image(); image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/fishing/fish-breach.png`);
    await image.decode();
    if (image.naturalWidth !== breach.frameSize * FRAME_COUNT || image.naturalHeight !== breach.frameSize)
      throw new Error('Invalid fish breach sprite sheet.');
    fishSheet = image;
  })()]).then(() => {});
}

export function fishArtFrame(fish: FishAppearance, time = 0): readonly [number, number, number, number] {
  return [Math.max(0, fishSurfaceFrame(fish, time)) * breach.frameSize, 0, breach.frameSize, breach.frameSize];
}
/** Staggered 20–28 second dives. The short breach is presentation only;
 * quantized generated frames keep GPU atlas entries finite. */
export function fishSurfaceFrame(fish: Pick<FishingFish, 'id'> & Partial<Pick<FishingFish, 'spawnedAt'>>, time: number): number {
  const period = 20 + (Math.imul(fish.id, 7) >>> 0) % 9, offset = ((Math.imul(fish.id, 2654435761) >>> 0) / 4294967296) * period;
  const phase = ((time - (fish.spawnedAt ?? 0) + offset) % period + period) % period;
  if (phase >= surfaceSeconds) return -1;
  for (let frame = 0; frame < FRAME_COUNT; frame++) if (phase < FRAME_ENDS[frame]) return frame;
  return -1;
}
/** Mirror horizontally without turning the airborne fish and splash sideways. */
export const fishBreachMirrored = (fish: Pick<FishingFish, 'facing'>): boolean => Math.cos(fish.facing) < -.01;
/** Two orientations × eleven generated frames, plus the shared submerged state. */
export function fishArtKey(fish: FishAppearance, time = 0): string {
  const frame = fishSurfaceFrame(fish, time);
  return frame < 0 ? 'submerged' : `breach:${Number(fishBreachMirrored(fish))}:${frame}`;
}
export function fishingBoatArtKey(boat: Pick<FishingBoat, 'facing'>, _time = 0): string { return `sail:${sailboatMirrored(boat)}`; }

export function drawFish(c: CanvasRenderingContext2D, fish: FishAppearance, x: number, y: number, size: number, time = 0): void {
  const frame = fishSurfaceFrame(fish, time); if (frame < 0 || !fishSheet) return;
  c.save(); c.imageSmoothingEnabled = false;
  const mirrored = fishBreachMirrored(fish);
  c.translate(x + (mirrored ? size : 0), y);
  if (mirrored) c.scale(-1, 1);
  c.drawImage(fishSheet, ...fishArtFrame(fish, time), 0, 0, size, size);
  c.restore();
}
export function drawFishingBoat(c: CanvasRenderingContext2D, boat: Pick<FishingBoat, 'facing'>, x: number, y: number, size: number, _time = 0): void {
  drawSailboat(c, boat, x, y, size);
}
