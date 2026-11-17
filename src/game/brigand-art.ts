import { runtimeArtUrl } from './runtime-art';
import type { Unit } from './types';

/** Existing PixelLab brigand: 48px frames, S, SE, E, NE, N, NW, W, SW.
 * Crowns reuse the PixelLab civilian crown; all compositing and palette work
 * happens once per sheet/color, never per entity or rendered frame. */
const FRAME = 48, WIDTH = 384, HEIGHT = 1200;
const LAYOUT = { idle: { y: 0, columns: 8, rows: 1 }, walk: { y: 48, columns: 8, rows: 8 },
  attack: { y: 432, columns: 7, rows: 8 }, death: { y: 816, columns: 8, rows: 8 } } as const;
let sources: [ImageData, ImageData] | undefined;
let loading: Promise<void> | undefined;
const sheets = new Map<string, HTMLCanvasElement>();

export const usesBrigandArt = (unit: Pick<Unit, 'kind' | 'marauderPack' | 'marauderLeader'>): boolean =>
  unit.kind!=='archer'&&(!!unit.marauderLeader || unit.marauderPack !== undefined && (unit.kind === 'warrior' || unit.kind === 'swordsman'));

export function loadBrigandArt(): Promise<void> {
  return loading ??= (async () => {
    const atlas = document.createElement('canvas'); atlas.width = WIDTH; atlas.height = HEIGHT;
    const c = atlas.getContext('2d')!;
    const crown = new Image(); crown.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/units/brigand/crown-source.png`);
    await Promise.all([crown.decode(), ...Object.entries(LAYOUT).map(async ([name, layout]) => {
      const image = new Image(); image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/units/brigand/${name}.png`);
      await image.decode();
      if (image.naturalWidth !== layout.columns * FRAME || image.naturalHeight !== layout.rows * FRAME)
        throw new Error(`Invalid brigand ${name} sheet.`);
      c.drawImage(image, 0, layout.y);
    })]);
    const plain = c.getImageData(0, 0, WIDTH, HEIGHT);
    // Register the generated crown to the hood in each authored frame, including
    // head bob, lunges and the falling corpse. Brown equipment sits below it.
    for (const layout of Object.values(LAYOUT)) for (let row = 0; row < layout.rows; row++) for (let col = 0; col < layout.columns; col++) {
      const ox = col * FRAME, oy = layout.y + row * FRAME;
      let top = -1, sumX = 0, count = 0;
      for (let y = 0; y < FRAME && (top < 0 || y < top + 3); y++) {
        const xs: number[] = [];
        for (let x = 0; x < FRAME; x++) {
          const i = ((oy + y) * WIDTH + ox + x) * 4, p = plain.data;
          if (p[i + 3] && p[i] >= 30 && p[i] < 150 && p[i] > p[i + 1] * 1.25 && p[i + 1] > p[i + 2] * 1.15) xs.push(x);
        }
        if (top < 0 && xs.length < 2) continue;
        if (top < 0) top = y;
        for (const x of xs) { sumX += x; count++; }
      }
      if (count) c.drawImage(crown, 13, 9, 6, 3, ox + Math.round(sumX / count) - 3, oy + top - 2, 6, 3);
    }
    sources = [plain, c.getImageData(0, 0, WIDTH, HEIGHT)];
  })();
}

export function brigandSheet(color: string, crowned = false): HTMLCanvasElement | undefined {
  if (!sources) return;
  const key = `${color}:${crowned}`, cached = sheets.get(key); if (cached) return cached;
  const sheet = document.createElement('canvas'); sheet.width = WIDTH; sheet.height = HEIGHT;
  const c = sheet.getContext('2d')!, pixels = c.createImageData(WIDTH, HEIGHT), data = pixels.data;
  data.set(sources[Number(crowned)].data);
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (!data[i + 3] || !(g > r + 24 && b > r + 8 && g >= b - 30)) continue;
    const shade = Math.max(r, g, b) / 170;
    for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.min(255, Math.round(rgb[channel] * shade));
  }
  c.putImageData(pixels, 0, 0); sheets.set(key, sheet); return sheet;
}

function directionRow(facing: number): number {
  const octant = ((Math.round(facing / (Math.PI / 4)) % 8) + 8) % 8;
  return [2, 1, 0, 7, 6, 5, 4, 3][octant];
}
export function brigandPose(unit: Pick<Unit, 'id' | 'facing' | 'moving' | 'attackTime'>, time: number): { rect: [number, number, number, number] } {
  const row = directionRow(unit.facing);
  if (unit.attackTime > 0) {
    const frame = Math.min(6, Math.floor((.28 - Math.min(.28, unit.attackTime)) / .28 * 7));
    return { rect: [frame * FRAME, LAYOUT.attack.y + row * FRAME, FRAME, FRAME] };
  }
  if (unit.moving) return { rect: [(Math.floor(time * 10 + unit.id * .37) % 8) * FRAME, LAYOUT.walk.y + row * FRAME, FRAME, FRAME] };
  return { rect: [row * FRAME, 0, FRAME, FRAME] };
}
export function brigandDeathPose(unit: Pick<Unit, 'facing'>, age: number): { rect: [number, number, number, number] } {
  return { rect: [Math.min(7, Math.max(0, Math.floor(age * 10))) * FRAME, LAYOUT.death.y + directionRow(unit.facing) * FRAME, FRAME, FRAME] };
}
// Match the other infantry's visible height around the shared foot anchor.
const SCALE = 1.4;
export const BRIGAND_BOUNDS = { x: 16 - 24 * SCALE, y: 27.2 - 31 * SCALE, width: FRAME * SCALE, height: FRAME * SCALE } as const;

export function drawBrigand(c: CanvasRenderingContext2D, unit: Unit, time: number, color: string): void {
  const sheet = brigandSheet(color, !!unit.marauderLeader); if (!sheet || unit.inside) return;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(sheet, ...brigandPose(unit, time).rect, BRIGAND_BOUNDS.x, BRIGAND_BOUNDS.y, BRIGAND_BOUNDS.width, BRIGAND_BOUNDS.height); c.restore();
}
