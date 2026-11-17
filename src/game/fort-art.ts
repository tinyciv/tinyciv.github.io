import { runtimeArtUrl } from './runtime-art';
import type { PunyPixels } from './puny-world';
import { loadNameplateArt } from './nameplate';

/** Every level uses the same full canvas and center on a reserved 3×3 plot. */
export const FORT_SPRITE = { width: 48, height: 48, source: [0, 0, 48, 48], groundAnchor: [24, 24] } as const;
export const FORT_ROOF_RECT = [18, 13, 13, 7] as const;
const forts = new Map<number, PunyPixels>();
let loading: Promise<void> | undefined;
const sprites = new Map<string, HTMLCanvasElement>();
function normalizedColor(color: string): string {
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(color);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
    : /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : '#3988ff';
}
/** Both levels share the original roof; its bounds exclude the moat water. */
export function recolorFortPixels(source: PunyPixels, color: string): PunyPixels {
  if (source.width !== FORT_SPRITE.width || source.height !== FORT_SPRITE.height) throw new RangeError('Invalid Fort artwork dimensions.');
  const data = new Uint8ClampedArray(source.data), faction = normalizedColor(color);
  const rgb = [1, 3, 5].map(index => parseInt(faction.slice(index, index + 2), 16));
  const [left, top, width, height] = FORT_ROOF_RECT;
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
    const offset = (y * source.width + x) * 4, red = data[offset], green = data[offset + 1], blue = data[offset + 2];
    if (!data[offset + 3] || blue < red + 8 || blue < green + 5 || blue - green < (blue - red) * .3) continue;
    const shade = blue / 180;
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.min(255, Math.round(rgb[channel] * shade));
  }
  return { width: source.width, height: source.height, data };
}
export function loadFortArt(): Promise<void> {
  return loading ??= (async () => {
    await loadNameplateArt();
    await Promise.all([1, 2].map(async level => {
      const image = new Image(); image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/buildings/fort-level-${level}.png`); await image.decode();
      if (image.naturalWidth !== 48 || image.naturalHeight !== 48) throw new Error('Invalid Fort artwork dimensions.');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      forts.set(level, { width: 48, height: 48, data: context.getImageData(0, 0, 48, 48).data });
    }));
  })();
}
export function drawFort(c: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, level = 1): void {
  const fort = forts.get(level); if (!fort) return;
  const faction = normalizedColor(color), key = `${level}:${faction}`;
  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas'); sprite.width = sprite.height = 48;
    const context = sprite.getContext('2d')!, pixels = context.createImageData(48, 48);
    pixels.data.set(recolorFortPixels(fort, faction).data); context.putImageData(pixels, 0, 0); sprites.set(key, sprite);
  }
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(sprite, x, y, size, size); c.restore();
}
