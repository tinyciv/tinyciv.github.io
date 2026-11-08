import type { PunyPixels } from './puny-world';

/** User-selected Fort geometry; only the blue roof receives faction colors. */
export const FORT_SPRITE = {
  width: 1254, height: 1254,
  // Exclude transparent canvas padding and faint stray pixels outside the fort.
  source: [144, 156, 968, 974],
  groundAnchor: [628, 1130],
} as const;
export const FORT_ROOF_RECT = [467, 339, 320, 155] as const;
let fort: PunyPixels | undefined;
let loading: Promise<void> | undefined;
const sprites = new Map<string, HTMLCanvasElement>();

function normalizedColor(color: string): string {
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(color);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
    : /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : '#3988ff';
}

/** Preserve stone, timber, outlines and transparency. Restrict tinting to the
 * actual roof rectangle and its blue pixels, retaining their original shading. */
export function recolorFortPixels(source: PunyPixels, color: string): PunyPixels {
  if (source.width !== FORT_SPRITE.width || source.height !== FORT_SPRITE.height)
    throw new RangeError('Invalid Fort artwork dimensions.');
  const data = new Uint8ClampedArray(source.data), faction = normalizedColor(color);
  const rgb = [1, 3, 5].map(index => parseInt(faction.slice(index, index + 2), 16));
  const [left, top, width, height] = FORT_ROOF_RECT;
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
    const offset = (y * source.width + x) * 4, red = data[offset], green = data[offset + 1], blue = data[offset + 2];
    if (!data[offset + 3] || blue < red + 8 || blue < green + 5) continue;
    const shade = blue / 180;
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.min(255, Math.round(rgb[channel] * shade));
  }
  return { width: source.width, height: source.height, data };
}

export function loadFortArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}assets/buildings/fort.png`;
    await image.decode();
    if (image.naturalWidth !== FORT_SPRITE.width || image.naturalHeight !== FORT_SPRITE.height)
      throw new Error('Invalid Fort artwork dimensions.');
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    fort = { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  })();
}

/** Bottom-center anchoring keeps the visible foundation on its two-cell plot. */
export function drawFort(c: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  if (!fort) return;
  const faction = normalizedColor(color);
  let sprite = sprites.get(faction);
  if (!sprite) {
    sprite = document.createElement('canvas'); sprite.width = fort.width; sprite.height = fort.height;
    const context = sprite.getContext('2d')!, pixels = context.createImageData(fort.width, fort.height);
    pixels.data.set(recolorFortPixels(fort, faction).data);
    context.putImageData(pixels, 0, 0); sprites.set(faction, sprite);
  }
  const [sx, sy, width, height] = FORT_SPRITE.source;
  const scale = size / Math.max(width, height), drawnWidth = width * scale, drawnHeight = height * scale;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(sprite, sx, sy, width, height, x + (size - drawnWidth) / 2, y + size - drawnHeight, drawnWidth, drawnHeight);
  c.restore();
}
