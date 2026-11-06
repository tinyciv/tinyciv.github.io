import type { FishingBoat, FishingFish } from './fishing';
import { drawSailboat, loadNavalArt, sailboatMirrored } from './naval-art';

let fishSheet: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

/** Unmodified native Miniworld sheets; no generated or resampled source art. */
export function loadFishingArt(): Promise<void> {
  return loading ??= Promise.all([loadNavalArt(), ...[['Fish-Sheet.png', 80, 64]].map(async ([file, width, height]) => {
    const image = new Image(); image.src = `${import.meta.env.BASE_URL}assets/miniworld/${file}`;
    await image.decode();
    if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error(`Invalid fishing sprite: ${file}`);
    fishSheet = image;
  })]).then(() => {});
}

export function fishArtFrame(fish: Pick<FishingFish, 'id' | 'facing'>): readonly [number, number, number, number] {
  const horizontal = Math.abs(Math.cos(fish.facing)) >= Math.abs(Math.sin(fish.facing));
  const row = horizontal ? Math.cos(fish.facing) < 0 ? 16 : 32 : Math.sin(fish.facing) < 0 ? 0 : 48;
  return [fish.id % 3 === 0 ? 32 : 48, row, 16, 16];
}
type FishAppearance = Pick<FishingFish, 'id' | 'facing'> & Partial<Pick<FishingFish, 'spawnedAt'>>;
/** Staggered 20–28 second dives: a brief glimpse followed by a small ripple.
 * Sixteen quantized surface frames keep GPU atlas entries finite. */
export function fishSurfaceFrame(fish: Pick<FishingFish, 'id'> & Partial<Pick<FishingFish, 'spawnedAt'>>, time: number): number {
  const period = 20 + (Math.imul(fish.id, 7) >>> 0) % 9, offset = ((Math.imul(fish.id, 2654435761) >>> 0) / 4294967296) * period;
  const phase = ((time - (fish.spawnedAt ?? 0) + offset) % period + period) % period;
  return phase < 2.2 ? Math.min(15, Math.floor(phase / 2.2 * 16)) : -1;
}
/** Two native fish × four directions × sixteen surface states. */
export function fishArtKey(fish: FishAppearance, time = 0): string { return `${fishArtFrame(fish).slice(0, 2).join(':')}:${fishSurfaceFrame(fish, time)}`; }
export function fishingBoatArtKey(boat: Pick<FishingBoat, 'facing'>, _time = 0): string { return `sail:${sailboatMirrored(boat)}`; }

export function drawFish(c: CanvasRenderingContext2D, fish: FishAppearance, x: number, y: number, size: number, time = 0): void {
  const frame = fishSurfaceFrame(fish, time); if (frame < 0) return;
  c.save(); c.imageSmoothingEnabled = false;
  // The native fish briefly shows through the water, then disappears while its
  // expanding pixel ripple fades. Most swimming fish have no visible mark.
  if (fishSheet && frame <= 6) {
    c.globalAlpha = Math.sin(frame / 7 * Math.PI) * .65;
    c.drawImage(fishSheet, ...fishArtFrame(fish), x, y, size, size);
  }
  c.translate(x, y); c.scale(size / 16, size / 16);
  const rx = 2 + Math.floor(frame / 4), ry = 1 + Math.floor(frame / 8);
  c.globalAlpha = .38 * (1 - frame / 16); c.fillStyle = '#c2e9de';
  c.fillRect(8 - rx + 1, 9 - ry, Math.max(1, rx * 2 - 2), 1);
  c.fillRect(8 - rx + 1, 9 + ry, Math.max(1, rx * 2 - 2), 1);
  c.fillRect(8 - rx, 9 - ry + 1, 1, Math.max(1, ry * 2 - 1));
  c.fillRect(8 + rx - 1, 9 - ry + 1, 1, Math.max(1, ry * 2 - 1));
  c.restore();
}
export function drawFishingBoat(c: CanvasRenderingContext2D, boat: Pick<FishingBoat, 'facing'>, x: number, y: number, size: number, _time = 0): void {
  drawSailboat(c, boat, x, y, size);
}
