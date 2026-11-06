import type { Unit } from './types';
import { drawPuny } from './puny-world';
import { armoredCharacterSheet, armorVisualLevel } from './armor-art';
import { drawHorseman } from './cavalry-art';
import { drawSpearman } from './siege-art';

/** Shade's Puny Characters companion uses 32px cells with 16px figures. */
export const PUNY_CHARACTERS = {
  leader: { file: 'Warrior-Blue.png', walk: [1, 2, 3], attack: [16, 17, 18] },
  archer: { file: 'Archer-Green.png', walk: [1, 2, 3], attack: [8, 9, 10, 11] },
  scout: { file: 'Scout.png', walk: [1, 2, 3], attack: [0] },
  warrior: { file: 'Human-Soldier-Cyan.png', walk: [1, 2, 3, 4], attack: [5, 6, 7, 8] },
  worker: { file: 'Human-Worker-Cyan.png', walk: [1, 2, 3, 4], attack: [5, 6, 7, 8] },
  marauder: { file: 'Orc-Grunt.png', walk: [1, 2, 3, 4], attack: [5, 6, 7, 8] },
} as const;
type Character = keyof typeof PUNY_CHARACTERS;
const sheets = new Map<Character, HTMLImageElement>();
const palettes = new Map<string, HTMLCanvasElement>();
const armoredPalettes = new Map<string, HTMLCanvasElement>();
const portraits = new Map<string, string>();
let loading: Promise<void> | undefined;

/** Fail explicitly on missing source art; there are no substitute drawn sprites. */
export function loadPunyCharacters(): Promise<void> {
  return loading ??= Promise.all(Object.entries(PUNY_CHARACTERS).map(async ([role, definition]) => {
    const image = new Image();
    const base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    image.src = `${base}assets/puny-world/characters/${definition.file}`;
    await image.decode();
    if (image.naturalWidth !== (role === 'scout' ? 128 : 768) || image.naturalHeight !== 256) throw new Error(`Invalid Puny character sheet: ${definition.file}`);
    sheets.set(role as Character, image);
  })).then(() => undefined);
}

/** Clockwise octants, with east at zero, as used by the movement simulation. */
export function facingOctant(angle: number): number {
  return ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
}

export function factionSheet(role: Character, color: string, armorLevel = 0): HTMLImageElement | HTMLCanvasElement | undefined {
  armorLevel = armorVisualLevel(armorLevel);
  if (armorLevel > 0 && (role === 'leader' || role === 'warrior')) {
    const level = armorLevel, key = `${role}:${color}:${level}`;
    const cached = armoredPalettes.get(key);
    if (cached) return cached;
    const source = factionSheet(role, color) as HTMLCanvasElement | undefined;
    if (!source) return undefined;
    const armored = armoredCharacterSheet(source, role, level, color);
    armoredPalettes.set(key, armored); return armored;
  }
  const source = sheets.get(role);
  if (!source) return source;
  const key = `${role}:${color}`, cached = palettes.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
  const c = canvas.getContext('2d')!;
  c.drawImage(source, 0, 0);
  const image = c.getImageData(0, 0, canvas.width, canvas.height), pixels = image.data;
  const faction = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  // Only the source's exact turquoise cloth shades are replaced. Skin, metal,
  // weapon effects and outlines remain the pack's original pixels.
  const shades = new Map([[46 * 256 + 39, .30], [75 * 256 + 63, .48], [79 * 256 + 67, .52], [121 * 256 + 102, .78], [180 * 256 + 157, 1]]);
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] !== 0 || pixels[index + 3] === 0) continue;
    const shade = shades.get(pixels[index + 1] * 256 + pixels[index + 2]);
    if (shade === undefined) continue;
    for (let channel = 0; channel < 3; channel++) pixels[index + channel] = Math.round(faction[channel] * shade);
  }
  applyChestCloth(pixels, canvas.width, canvas.height, color);
  c.putImageData(image, 0, 0);
  palettes.set(key, canvas);
  return canvas;
}

/** Add a shaded tabard to the torso in each native animation cell. Opaque
 * source pixels clip it to the body; outlines, faces, hands and weapons remain. */
export function applyChestCloth(pixels: Uint8ClampedArray, width: number, height: number, color: string): void {
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  for (let row = 0; row < Math.min(8, height / 32); row++) for (let frame = 0; frame < Math.min(19, width / 32); frame++) {
    const offsetX = frame * 32, offsetY = row * 32;
    const center = [15.5, 15.5, 15, 15, 15.5, 16, 16, 15.5][row];
    const clothWidth = row === 2 || row === 6 ? 3 : row % 2 ? 4 : 5;
    const left = Math.round(center - (clothWidth - 1) / 2);
    // Footfalls shift the body by a pixel in the walk cycle. Anchor the cloth
    // to the central feet, independently of extended arms and weapon arcs.
    let feet = 22;
    for (let y = 25; y >= 20; y--) {
      let count = 0;
      for (let x = 13; x <= 18; x++) if (pixels[((offsetY + y) * width + offsetX + x) * 4 + 3] > 200) count++;
      if (count >= 2) { feet = y; break; }
    }
    for (let y = feet - 4; y < feet; y++) for (let x = left; x < left + clothWidth; x++) {
      const index = ((offsetY + y) * width + offsetX + x) * 4;
      if (pixels[index + 3] < 200) continue;
      const light = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
      if (light < 25 || light > 215) continue;
      const edge = x === left || x === left + clothWidth - 1;
      const shade = edge ? .62 : y === feet - 4 ? 1.18 : y === feet - 1 ? .76 : 1;
      for (let channel = 0; channel < 3; channel++) pixels[index + channel] = Math.min(255, Math.round(rgb[channel] * shade));
    }
  }
}

/** The selection portrait uses the same faction cloth as the world figure. */
export function characterIconUrl(role: Character, color: string, armorLevel = 0): string {
  armorLevel = armorVisualLevel(armorLevel);
  const key = `${role}:${color}:${armorLevel}`, cached = portraits.get(key);
  if (cached) return cached;
  const sheet = factionSheet(role, color, armorLevel);
  if (!sheet) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  canvas.getContext('2d')!.drawImage(sheet, 0, 0, 32, 32, 0, 0, 32, 32);
  const url = canvas.toDataURL(); portraits.set(key, url);
  return url;
}

/** Eight original perspectives, with faction cloth following each animation. */
export function personFrame(unit: Unit, time: number): { role: Character; row: number; frame: number } {
  if (unit.kind !== 'leader' && unit.kind !== 'warrior' && unit.kind !== 'archer' && unit.kind !== 'scout' && unit.kind !== 'militia' && unit.kind !== 'worker')
    return { role: 'worker', row: 0, frame: 0 };
  const role: Character = unit.marauderLeader ? 'leader' : unit.kind === 'archer' ? 'archer' : unit.marauderPack !== undefined ? 'marauder' : unit.kind === 'militia' ? 'warrior' : unit.kind;
  const definition = PUNY_CHARACTERS[role];
  // Rows are S, SE, E, NE, N, NW, W, SW.
  const row = (10 - facingOctant(unit.facing)) % 8;
  let frame = 0;
  if (unit.kind !== 'scout' && unit.attackTime > 0) frame = definition.attack[Math.min(definition.attack.length - 1, Math.floor((.28 - Math.min(.28, unit.attackTime)) / .28 * definition.attack.length))];
  else if (unit.kind === 'worker' && unit.order === 'work' && !unit.moving) frame = definition.attack[Math.floor(time * 4 + unit.id * .23) % 4];
  else if (unit.moving) frame = definition.walk[Math.floor(time * 9 + unit.id * .37) % definition.walk.length];
  return { role, row, frame };
}

export function drawPerson(c: CanvasRenderingContext2D, unit: Unit, time: number, color: string): void {
  if (unit.kind === 'horseman') { drawHorseman(c, unit, time, color); return; }
  if (unit.kind === 'spearman') { drawSpearman(c, unit, time, color); return; }
  if (unit.inside || (unit.kind !== 'leader' && unit.kind !== 'warrior' && unit.kind !== 'archer' && unit.kind !== 'scout' && unit.kind !== 'militia' && unit.kind !== 'worker')) return;
  const { role, row, frame } = personFrame(unit, time), sheet = factionSheet(role, color, unit.armorLevel);
  if (!sheet) return;
  c.save();
  c.imageSmoothingEnabled = false;
  // Reduce just the artwork around its original foot anchor. World positions,
  // pathfinding cells and collision footprints are unaffected.
  c.translate(16, 27.2); c.scale(.7, .7); c.translate(-16, -27.2);
  c.drawImage(sheet, frame * 32, row * 32, 32, 32, -16, -18, 64, 64);
  if ((unit.cargo ?? 0) > 0)
    drawPuny(c, 9 * 16 + 2, 31 * 16 + 5, 12, 10, 11, 13, 14, 12);
  c.restore();
}
