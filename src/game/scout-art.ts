import { loadObservationPostArt } from './observation-post-art';
import type { PunyPixels } from './puny-world';

/** Original 16×16 Medieval thatched cottage; the paired native faction sprites
 * identify its small cloth trim without tinting thatch, timber or the chimney. */
let originals: PunyPixels[] | undefined;
let loading: Promise<void> | undefined;
const sprites = new Map<string, HTMLCanvasElement>();
const icons = new Map<string, string>();

export function recolorScoutsLodgePixels(source: PunyPixels, blue: PunyPixels, red: PunyPixels, color: string): PunyPixels {
  const data = new Uint8ClampedArray(source.data);
  const hex = /^#[\da-f]{6}$/i.test(color) ? color : '#c94c4c';
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  for (let offset = 0; offset < data.length; offset += 4) {
    if (!data[offset + 3] || ![0, 1, 2].some(channel => source.data[offset + channel] !== blue.data[offset + channel]
      || source.data[offset + channel] !== red.data[offset + channel])) continue;
    const value = Math.max(blue.data[offset], blue.data[offset + 1], blue.data[offset + 2]) / 255;
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(rgb[channel] * (.3 + .7 * value));
  }
  return { width: source.width, height: source.height, data };
}

export function loadScoutsLodgeArt(): Promise<void> {
  return loading ??= (async () => {
    await loadObservationPostArt();
    originals = await Promise.all(['Scouts-Lodge', 'Scouts-Lodge-blue', 'Scouts-Lodge-red'].map(async name => {
      const image = new Image(); image.src = `${import.meta.env.BASE_URL}assets/medieval/${name}.png`;
      await image.decode();
      if (image.naturalWidth !== 16 || image.naturalHeight !== 16) throw new Error('Invalid Scouts’ Lodge artwork.');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, 16, 16);
    }));
  })();
}

function sprite(color: string): HTMLCanvasElement | undefined {
  if (!originals) return;
  let result = sprites.get(color);
  if (!result) {
    result = document.createElement('canvas'); result.width = result.height = 16;
    const context = result.getContext('2d')!, pixels = context.createImageData(16, 16);
    pixels.data.set(recolorScoutsLodgePixels(originals[0], originals[1], originals[2], color).data);
    context.putImageData(pixels, 0, 0); sprites.set(color, result);
  }
  return result;
}

/** Used by both world rendering and the shared activity-silhouette renderer. */
export function drawScoutsLodge(c: CanvasRenderingContext2D, x: number, y: number, size: number, color = '#c94c4c'): void {
  const image = sprite(color);
  if (!image) return;
  c.save(); c.imageSmoothingEnabled = false; c.drawImage(image, x, y, size, size); c.restore();
}

export function scoutsLodgeIconUrl(color = '#c94c4c'): string {
  const image = sprite(color);
  if (!image) return `${import.meta.env.BASE_URL}assets/medieval/Scouts-Lodge-red.png`;
  let icon = icons.get(color);
  if (!icon) { icon = image.toDataURL('image/png'); icons.set(color, icon); }
  return icon;
}
