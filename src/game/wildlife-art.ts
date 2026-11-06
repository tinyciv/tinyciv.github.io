import type { Unit } from './types';

type WildlifeKind = 'boar' | 'marshBird';
type WildlifeSheet = HTMLImageElement | HTMLCanvasElement;
/** Original Miniworld 16px cells. Boar rows are S/N/E/W; chicken S/N/W/E. */
const sheets: Partial<Record<WildlifeKind, WildlifeSheet>> = {};
const portraits: Partial<Record<WildlifeKind, string>> = {};
let loading: Promise<void> | undefined;

/** Only the two red comb/wattle colors change. Feather, beak, outline and
 * transparent pixels stay byte-for-byte identical to Shade's chicken. */
export const MARSH_BIRD_PALETTE = [
  { from: [188, 78, 78], to: [137, 154, 100] },
  { from: [164, 52, 52], to: [89, 107, 67] },
] as const;
export function recolorMarshBird(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const color = MARSH_BIRD_PALETTE.find(({ from }) => data[i] === from[0] && data[i + 1] === from[1] && data[i + 2] === from[2]);
    if (color) { data[i] = color.to[0]; data[i + 1] = color.to[1]; data[i + 2] = color.to[2]; }
  }
}

export const wildlifeImage = (kind: WildlifeKind = 'boar'): WildlifeSheet | undefined => sheets[kind];
export function loadWildlifeArt(): Promise<void> {
  return loading ??= (async () => {
    const [boar, chicken] = await Promise.all(['Boar', 'Chicken'].map(async name => {
      const image = new Image();
      image.src = `${import.meta.env.BASE_URL}assets/miniworld/${name}.png`;
      await image.decode();
      if (image.naturalWidth !== 64 || image.naturalHeight !== (name === 'Boar' ? 128 : 64)) throw new Error(`Invalid Miniworld ${name} sheet.`);
      return image;
    }));
    const bird = document.createElement('canvas'); bird.width = bird.height = 64;
    const context = bird.getContext('2d')!;
    context.drawImage(chicken, 0, 0);
    const pixels = context.getImageData(0, 0, 64, 64);
    recolorMarshBird(pixels.data); context.putImageData(pixels, 0, 0);
    sheets.boar = boar; sheets.marshBird = bird;
  })();
}
export function wildlifeFrame(unit: Unit, time: number): { row: number; frame: number } {
  const east = Math.cos(unit.facing), south = Math.sin(unit.facing);
  const eastRow = unit.kind === 'marshBird' ? 3 : 2, westRow = unit.kind === 'marshBird' ? 2 : 3;
  const row = Math.abs(east) > Math.abs(south) ? east >= 0 ? eastRow : westRow : south >= 0 ? 0 : 1;
  const frame = unit.moving ? Math.floor(time * 9 + unit.id * .37) % 4 : 0;
  return { row, frame };
}
export function drawWildlife(c: CanvasRenderingContext2D, unit: Unit, time: number): void {
  const sheet = unit.kind === 'boar' || unit.kind === 'marshBird' ? wildlifeImage(unit.kind) : undefined;
  if (!sheet) return;
  const { row, frame } = wildlifeFrame(unit, time);
  c.imageSmoothingEnabled = false;
  c.drawImage(sheet, frame * 16, row * 16, 16, 16, 0, 0, 32, 32);
}
function wildlifeIconUrl(kind: WildlifeKind): string {
  const sheet = wildlifeImage(kind);
  if (!sheet) return '';
  if (!portraits[kind]) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
    canvas.getContext('2d')!.drawImage(sheet, 0, 32, 16, 16, 0, 0, 16, 16);
    portraits[kind] = canvas.toDataURL();
  }
  return portraits[kind]!;
}
export const boarIconUrl = (): string => wildlifeIconUrl('boar');
export const birdIconUrl = (): string => wildlifeIconUrl('marshBird');
