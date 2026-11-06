/** Shade's native Miniworld Garrison/Bunker, one unscaled 16px source cell. */
export const GUARD_POST_SPRITE = { width: 16, height: 16 } as const;
const roofShades = new Map([
  [0xe2ad6e, 1.12], [0xbc8b4d, .92], [0x93674d, .72],
]);
let source: ImageData | undefined;
let loading: Promise<void> | undefined;
const sprites = new Map<string, HTMLCanvasElement>();

/** These three exact roof shades are the only pixels that differ in the
 * source's Wood, Cyan and Red faction cells. Stone, timber, outlines and alpha
 * stay untouched; no faction flags are added. */
export function recolorGuardPostPixels(pixels: Uint8ClampedArray, color: string): Uint8ClampedArray {
  const output = new Uint8ClampedArray(pixels);
  const hex = /^#[\da-f]{6}$/i.test(color) ? color : '#3988ff';
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  for (let i = 0; i < output.length; i += 4) {
    if (!output[i + 3]) continue;
    const shade = roofShades.get((output[i] << 16) | (output[i + 1] << 8) | output[i + 2]);
    if (shade === undefined) continue;
    for (let channel = 0; channel < 3; channel++) output[i + channel] = Math.min(255, Math.round(rgb[channel] * shade));
  }
  return output;
}

export function loadGuardPostArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}assets/miniworld/Guard-Post.png`;
    await image.decode();
    if (image.naturalWidth !== 16 || image.naturalHeight !== 16)
      throw new Error('Invalid Miniworld guard-post cell.');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
    const c = canvas.getContext('2d')!;
    c.drawImage(image, 0, 0); source = c.getImageData(0, 0, 16, 16);
  })();
}

export function drawGuardPost(c: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  if (!source) return;
  let sprite = sprites.get(color);
  if (!sprite) {
    sprite = document.createElement('canvas'); sprite.width = sprite.height = 16;
    const context = sprite.getContext('2d')!, image = context.createImageData(16, 16);
    image.data.set(recolorGuardPostPixels(source.data, color)); context.putImageData(image, 0, 0);
    sprites.set(color, sprite);
  }
  c.imageSmoothingEnabled = false;
  c.drawImage(sprite, x, y, size, size);
}
