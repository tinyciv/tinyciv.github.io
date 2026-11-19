import { buildingFactionColor, buildingFactionShade } from './puny-building-art';
import type { PunyPixels } from './puny-world';
import { runtimeArtUrl } from './runtime-art';

const NATIVE_SIZE = 32;
// Audited against the approved sprite. Its center and corner roofs use distinct
// ramps. These swatches occur only on roof planes, clear of the timber and trim.
const ROOF_COLORS = new Set([
  0x8d483d, 0xb1664d, 0x89473e, 0xa75945, 0x95483b, 0x9a4c3e, 0xb06048, 0x954d41, 0x9c5144, 0x512922, 0x612e27,
  0xb06431, 0xaa6232, 0x985530, 0x98502b, 0xbb6d37, 0x8f502e, 0xcd7a3d, 0x914e2a, 0xa35c34, 0xc5713a, 0x8a4b2b, 0xcf7438,
]);

export function recolorFrontierVillagePixels(source: PunyPixels, color: string): PunyPixels {
  const data = new Uint8ClampedArray(source.data);
  const faction = buildingFactionColor(color), shades = new Map<number, readonly number[]>();
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const r = data[index], g = data[index + 1], b = data[index + 2];
    if (!ROOF_COLORS.has((r << 16) | (g << 8) | b)) continue;
    const brightness = Math.max(r, g, b);
    let shade = shades.get(brightness);
    if (!shade) { shade = buildingFactionShade(faction, brightness); shades.set(brightness, shade); }
    data.set(shade, index);
  }
  return { width: source.width, height: source.height, data };
}

let source: PunyPixels | undefined;
let loading: Promise<void> | undefined;
const sprites = new Map<string, HTMLCanvasElement>();

export function loadFrontierVillageArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/buildings/frontier-village.png`);
    await image.decode();
    if (image.naturalWidth !== NATIVE_SIZE || image.naturalHeight !== NATIVE_SIZE) throw new Error('Invalid Village artwork.');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = NATIVE_SIZE;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    source = context.getImageData(0, 0, NATIVE_SIZE, NATIVE_SIZE);
  })();
}

export function drawFrontierVillage(c: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  if (!source) return;
  let sprite = sprites.get(color);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = NATIVE_SIZE;
    const context = sprite.getContext('2d')!, image = context.createImageData(NATIVE_SIZE, NATIVE_SIZE);
    image.data.set(recolorFrontierVillagePixels(source, color).data);
    context.putImageData(image, 0, 0);
    sprites.set(color, sprite);
  }
  c.imageSmoothingEnabled = false;
  c.drawImage(sprite, x, y, size, size);
}
