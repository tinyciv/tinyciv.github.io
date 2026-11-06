import { loadPunyWorld, punyWorldPixels } from './puny-world';
import { NATIVE_BUILDINGS, recolorPunyBuildingPixels } from './puny-building-art';

/** Approved 1C primitive thatch courtyard, authored on a native 32px grid. */
let source: ImageData | undefined;
let teamMask: Uint8Array | undefined;
let loading: Promise<void> | undefined;
const sprites = new Map<string, HTMLCanvasElement>();

export function loadLibraryArt(): Promise<void> {
  return loading ??= (async () => {
    await loadPunyWorld();
    const images = await Promise.all(['Library', 'Library-blue', 'Library-red'].map(async name => {
      const image = new Image();
      image.src = `${import.meta.env.BASE_URL}assets/medieval/${name}.png`;
      await image.decode();
      if (image.naturalWidth !== 32 || image.naturalHeight !== 32) throw new Error('Invalid primitive library cell.');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const c = canvas.getContext('2d')!; c.drawImage(image, 0, 0);
      return c.getImageData(0, 0, 32, 32);
    }));
    source = images[0]; teamMask = new Uint8Array(32 * 32);
    // Paired previews identify only the roof. Wood, plaster, stone, water and
    // alpha remain the approved pixels rather than using a hue threshold.
    for (let pixel = 0; pixel < teamMask.length; pixel++) {
      const offset = pixel * 4;
      if (source.data[offset + 3] && images.some(image =>
        [0, 1, 2].some(channel => image.data[offset + channel] !== source!.data[offset + channel])))
        teamMask[pixel] = 1;
    }
  })();
}

export function drawLibrary(c: CanvasRenderingContext2D, x: number, y: number, size: number, time = 0, color = '#c94c4c'): void {
  if (!source || !teamMask) return;
  let sprite = sprites.get(color);
  if (!sprite) {
    sprite = document.createElement('canvas'); sprite.width = sprite.height = 32;
    const context = sprite.getContext('2d')!, pixels = context.createImageData(32, 32);
    pixels.data.set(source.data);
    // The approved roof uses the original Puny house's five ochre swatches.
    // Reuse that house's actual faction ramp so every color matches the houses
    // and the reviewed blue/red previews, including very light/dark factions.
    const atlas = punyWorldPixels()!, rect = NATIVE_BUILDINGS.houses[2].rect;
    const house = recolorPunyBuildingPixels(atlas, rect, color);
    const palette = new Map<number, Uint8ClampedArray>();
    for (let y = 0; y < rect[3]; y++) for (let x = 0; x < rect[2]; x++) {
      const pixel = y * rect[2] + x;
      if (!house.teamMask[pixel]) continue;
      const offset = ((rect[1] + y) * atlas.width + rect[0] + x) * 4;
      const key = atlas.data[offset] << 16 | atlas.data[offset + 1] << 8 | atlas.data[offset + 2];
      palette.set(key, house.data.subarray(pixel * 4, pixel * 4 + 3));
    }
    for (let pixel = 0; pixel < teamMask.length; pixel++) if (teamMask[pixel]) {
      const offset = pixel * 4;
      const key = source.data[offset] << 16 | source.data[offset + 1] << 8 | source.data[offset + 2];
      const shade = palette.get(key);
      if (shade) pixels.data.set(shade, offset);
    }
    context.putImageData(pixels, 0, 0); sprites.set(color, sprite);
  }
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(sprite, x, y, size * 2, size * 2);
  const pixel = size / 16, phase = Math.floor(time * 5) % 4;
  // A quiet ripple stays inside 1C's 4×3 water surface (x22–25, y22–24).
  c.fillStyle = '#44c9c2';
  c.fillRect(x + (phase < 2 ? 23 : 24) * pixel, y + (22 + phase % 3) * pixel, pixel, pixel);
  c.restore();
}
