import { runtimeArtUrl } from './runtime-art';
import type { Unit } from './types';

/** Approved first land batch (2026-11-12), 48px chibi frames in eight
 * directions ordered S, SE, E, NE, N, NW, W, SW; feet near (24, 31). The
 * sheets are packed into one atlas per faction color: idle (1 row × 8),
 * walk (8 × 8), attack (8 × 7, last frame returns to idle), death (8 × 8). */
const FRAME = 48;
const LAYOUT = { idle: { y: 0, columns: 8, rows: 1 }, walk: { y: 48, columns: 8, rows: 8 },
  attack: { y: 432, columns: 7, rows: 8 }, death: { y: 816, columns: 8, rows: 8 } } as const;
const ATLAS_WIDTH = 384, ATLAS_HEIGHT = 1200;
let source: ImageData | undefined;
let loading: Promise<void> | undefined;
const sheets = new Map<string, HTMLCanvasElement>();

export function loadMusketmanArt(): Promise<void> {
  return loading ??= (async () => {
    const atlas = document.createElement('canvas'); atlas.width = ATLAS_WIDTH; atlas.height = ATLAS_HEIGHT;
    const c = atlas.getContext('2d')!;
    await Promise.all((Object.keys(LAYOUT) as (keyof typeof LAYOUT)[]).map(async name => {
      const image = new Image();
      image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/units/musketman/${name}.png`);
      await image.decode();
      const { columns, rows, y } = LAYOUT[name];
      if (image.naturalWidth !== columns * FRAME || image.naturalHeight !== rows * FRAME) throw new Error(`Invalid musketman ${name} sheet.`);
      c.drawImage(image, 0, y);
    }));
    source = c.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
  })();
}

/** The authored tunic is teal; no paired team previews exist, so recolor the
 * clearly green-blue cloth by its shade. Steel, skin, wood and outline stay. */
const isTunic = (r: number, g: number, b: number): boolean => g > r + 24 && b > r + 8 && g >= b - 30;
export function musketmanSheet(color: string): HTMLCanvasElement | undefined {
  if (!source) return;
  let sheet = sheets.get(color);
  if (!sheet) {
    sheet = document.createElement('canvas'); sheet.width = ATLAS_WIDTH; sheet.height = ATLAS_HEIGHT;
    const c = sheet.getContext('2d')!, pixels = c.createImageData(ATLAS_WIDTH, ATLAS_HEIGHT), data = pixels.data;
    data.set(source.data);
    const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3] || !isTunic(data[i], data[i + 1], data[i + 2])) continue;
      const shade = Math.max(data[i], data[i + 1], data[i + 2]) / 170;
      for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.min(255, Math.round(rgb[channel] * shade));
    }
    c.putImageData(pixels, 0, 0); sheets.set(color, sheet);
  }
  return sheet;
}

/** Facing → sheet row (S, SE, E, NE, N, NW, W, SW). */
function directionRow(facing: number): number {
  const octant = ((Math.round(facing / (Math.PI / 4)) % 8) + 8) % 8; // 0 E, 1 SE, 2 S, … (y grows south)
  return [2, 1, 0, 7, 6, 5, 4, 3][octant];
}
export interface MusketmanPose { rect: [number, number, number, number] }
export function musketmanPose(unit: Pick<Unit, 'id' | 'facing' | 'moving' | 'attackTime'>, time: number): MusketmanPose {
  const row = directionRow(unit.facing);
  if (unit.attackTime > 0) {
    const frame = Math.min(LAYOUT.attack.columns - 1, Math.floor(((7 / 12) - Math.min(7 / 12, unit.attackTime)) / (7 / 12) * LAYOUT.attack.columns));
    return { rect: [frame * FRAME, LAYOUT.attack.y + row * FRAME, FRAME, FRAME] };
  }
  if (unit.moving) {
    const frame = Math.floor(time * 10 + unit.id * .37) % LAYOUT.walk.columns;
    return { rect: [frame * FRAME, LAYOUT.walk.y + row * FRAME, FRAME, FRAME] };
  }
  return { rect: [row * FRAME, LAYOUT.idle.y, FRAME, FRAME] };
}
/** Native size (the approved scale), feet on the shared infantry ground point. */
export const MUSKETMAN_BOUNDS = { x: 16 - 24, y: 27.2 - 31, width: FRAME, height: FRAME } as const;

export function drawMusketman(c: CanvasRenderingContext2D, unit: Unit, time: number, color: string): void {
  const sheet = musketmanSheet(color); if (!sheet || unit.inside) return;
  const pose = musketmanPose(unit, time);
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(sheet, ...pose.rect, MUSKETMAN_BOUNDS.x, MUSKETMAN_BOUNDS.y, MUSKETMAN_BOUNDS.width, MUSKETMAN_BOUNDS.height); c.restore();
}

/** The authored death rows hold their final frame before the common decay. */
export function musketmanDeathPose(unit: Pick<Unit, 'facing'>, age: number): MusketmanPose {
  return { rect: [Math.min(7, Math.max(0, Math.floor(age * 10))) * FRAME,
    LAYOUT.death.y + directionRow(unit.facing) * FRAME, FRAME, FRAME] };
}
