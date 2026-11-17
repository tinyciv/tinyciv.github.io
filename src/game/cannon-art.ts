import { runtimeArtUrl } from './runtime-art';
import type { Building } from './types';
import { cannonFireFrame, drawCannonFire } from './cannon-fire-art';

/** Approved PixelLab 16C: eight 16×16 views of the fixed siege cannon. */
const DIRECTIONS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'] as const;
const images = new Map<string, { image: HTMLImageElement; ground: number }>();
let loading: Promise<void> | undefined;
export function loadCannonArt(): Promise<void> {
  return loading ??= (async () => {
    await Promise.all(DIRECTIONS.map(async direction => {
      const image = new Image();
      image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/buildings/siege-cannon/${direction}.png`);
      await image.decode();
      // Ground the visible timber foundation rather than the API's padding.
      // This one-time alpha read never alters the authored source pixels.
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let ground = canvas.height;
      rows: for (let y = canvas.height - 1; y >= 0; y--) for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3]) { ground = y + 1; break rows; }
      }
      images.set(direction, { image, ground });
    }));
  })();
}
export function cannonFrame(building: Pick<Building, 'siegeFacing' | 'siegeShotAt'>, time: number): { direction: string; recoil: number; fire: number } {
  const angle = building.siegeFacing ?? -Math.PI / 2;
  const direction = DIRECTIONS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
  const age = building.siegeShotAt === undefined ? Infinity : time - building.siegeShotAt;
  return { direction, recoil: age >= 0 && age < .2 ? 1 : 0, fire: cannonFireFrame(building.siegeShotAt, time) };
}
export function drawCannon(c: CanvasRenderingContext2D, building: Pick<Building, 'siegeFacing' | 'siegeShotAt'>,
  x: number, y: number, size: number, time: number, fireEffects = true): void {
  const frame = cannonFrame(building, time), pose = images.get(frame.direction); if (!pose) return;
  const { image, ground } = pose;
  const angle = building.siegeFacing ?? -Math.PI / 2;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(image, x - Math.cos(angle) * frame.recoil * size * .04,
    y + size * (1 - ground / image.naturalHeight) - Math.sin(angle) * frame.recoil * size * .04, size, size); c.restore();
  if (fireEffects) drawCannonFire(c, building.siegeShotAt, time, angle, x + size / 2, y + size / 2, size, size * .375);
}
export const cannonIconUrl = (): string => `${import.meta.env.BASE_URL}assets/runtime/ui/siege-cannon.webp`;
