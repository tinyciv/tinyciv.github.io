import { runtimeArtUrl } from './runtime-art';
import type { Unit } from './types';
import { drawPerson } from './unit-sprites';
import { galleyScale } from './galley-footprint';

export const GALLEY_CELL = 32;
export const GALLEY_FRAME_SECONDS = .14;
export const GALLEY_ART_BOUNDS = { x: -16, y: -16, width: 64, height: 64 } as const;
export const GALLEY_PIVOT = { x: 16, y: 16 } as const;
export const TRADING_BOAT_SCALE = .4;
// North, east, south, west: feet and mast attachment in the native32px cell.
const CAPTAIN_FEET = [[16, 26], [7, 16], [16, 10], [24, 16]] as const;
const RIG_ANCHORS = [[16, 20], [16, 15], [16, 23], [16, 15]] as const;
const HEADINGS = [-Math.PI / 2, 0, Math.PI / 2, Math.PI] as const;
type BoatPose = Pick<Unit, 'facing'> & Partial<Pick<Unit, 'kind' | 'moving' | 'seaInvasion'>>;
let hulls: HTMLImageElement | undefined, rigs: HTMLImageElement | undefined, full: HTMLImageElement | undefined;
let leaderRowing: HTMLImageElement | undefined;
let loading: Promise<void> | undefined, icon: string | undefined;
export function loadGalleyArt(): Promise<void> {
  return loading ??= Promise.all(['galley-hulls.png', 'galley-rigs.png', 'galley.png', 'leader-galley-rowing.png'].map(async (file, index) => {
    const image = new Image(); image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/naval/${file}`);
    await image.decode();
    if (image.naturalWidth !== (index === 1 ? 32 : 192) || image.naturalHeight !== 128) throw new Error(`Invalid galley artwork: ${file}`);
    if (index === 0) hulls = image; else if (index === 1) rigs = image; else if (index === 2) full = image; else leaderRowing = image;
  })).then(() => undefined);
}
export const galleyHullImage = (boat?: BoatPose) => boat?.kind === 'sailboat' && boat.moving && boat.seaInvasion === undefined ? leaderRowing ?? hulls : hulls;
let grayRig: HTMLCanvasElement | undefined;
export function galleyRigImage(gray = false): HTMLImageElement | HTMLCanvasElement | undefined {
  if (!gray || !rigs) return rigs;
  if (grayRig) return grayRig;
  const canvas = document.createElement('canvas'); canvas.width = rigs.width; canvas.height = rigs.height;
  const c = canvas.getContext('2d')!; c.drawImage(rigs, 0, 0);
  const image = c.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
    // Recolor the existing linen palette, retaining its folds and wooden mast.
    if (image.data[i + 3] && r > 190 && g > 160 && b > 100) {
      const shade = Math.round((r + g + b) / 3 * .78);
      image.data[i] = shade; image.data[i + 1] = shade + 3; image.data[i + 2] = shade + 7;
    }
  }
  c.putImageData(image, 0, 0); return grayRig = canvas;
}

/** Four native perspectives with continuous hull rotation between them. The
 * rig and captain are separate upright layers, never tilted with the hull. */
export function galleyPose(boat: BoatPose, time = 0) {
  const quadrant = ((Math.round(boat.facing / (Math.PI / 2)) % 4) + 4) % 4;
  const row = [1, 2, 3, 0][quadrant];
  const rotation = Math.atan2(Math.sin(boat.facing - HEADINGS[row]), Math.cos(boat.facing - HEADINGS[row]));
  const frame = boat.moving ? ((Math.floor(time / GALLEY_FRAME_SECONDS) % 6) + 6) % 6 : 0;
  return { row, frame, rotation, heading: HEADINGS[row], rect: [frame * 32, row * 32, 32, 32] as [number, number, number, number] };
}

/** Translation of an upright deck attachment after the hull turns underneath it. */
export function galleyAttachmentOffset(boat: BoatPose, attachment: 'rig' | 'captain') {
  const { row, rotation } = galleyPose(boat), [px, py] = (attachment === 'rig' ? RIG_ANCHORS : CAPTAIN_FEET)[row];
  const dx = px - 16, dy = py - 16, cosine = Math.cos(rotation), sine = Math.sin(rotation);
  return { x: Math.round((dx * cosine - dy * sine - dx) * 2), y: Math.round((dx * sine + dy * cosine - dy) * 2) };
}

export function drawGalleyHull(c: CanvasRenderingContext2D, boat: BoatPose, x: number, y: number, size: number, time = 0): void {
  const image = galleyHullImage(boat);
  if (!image) return;
  const pose = galleyPose(boat, time);
  c.save(); c.imageSmoothingEnabled = false;
  c.translate(x + size / 2, y + size / 2); c.rotate(pose.rotation);
  c.drawImage(image, ...pose.rect, -size, -size, size * 2, size * 2); c.restore();
}
export function drawGalleyRig(c: CanvasRenderingContext2D, boat: BoatPose, x: number, y: number, size: number): void {
  const rig = galleyRigImage(boat.seaInvasion !== undefined);
  if (!rig) return;
  const { row } = galleyPose(boat), offset = galleyAttachmentOffset(boat, 'rig');
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(rig, 0, row * 32, 32, 32, x - size / 2 + offset.x * size / 32, y - size / 2 + offset.y * size / 32, size * 2, size * 2);
  c.restore();
}
export function drawGalleyPassenger(c: CanvasRenderingContext2D, boat: BoatPose, passenger: Unit,
  x: number, y: number, size: number, color: string, followTurn = true, firearm = false): void {
  const { row } = galleyPose(boat), feet = CAPTAIN_FEET[row];
  const offset = followTurn ? galleyAttachmentOffset(boat, 'captain') : { x: 0, y: 0 };
  const hullScale = galleyScale(boat);
  c.save(); c.translate(x + size / 2 + (feet[0] * 2 - 32 + offset.x) * hullScale * size / 32,
    y + size / 2 + (feet[1] * 2 - 32 + offset.y) * hullScale * size / 32);
  c.scale(size / 32, size / 32); c.translate(-16, -27.2);
  drawPerson(c, { ...passenger, inside: false, moving: false, attackTime: 0, cargo: 0, facing: boat.facing }, 0, color, firearm);
  c.restore();
}
export function drawLeaderGalley(c: CanvasRenderingContext2D, boat: Unit, passenger: Unit | undefined,
  x: number, y: number, size: number, time: number, color: string, firearm = false): void {
  const scale = galleyScale(boat), offset = size * (1 - scale) / 2;
  drawGalleyHull(c, boat, x + offset, y + offset, size * scale, time);
  if (passenger) drawGalleyPassenger(c, boat, passenger, x, y, size, color, true, firearm);
  drawGalleyRig(c, boat, x + offset, y + offset, size * scale);
}
export function drawTradingBoat(c: CanvasRenderingContext2D, boat: BoatPose,
  x: number, y: number, size: number, time = 0): void {
  const offset = size * (1 - TRADING_BOAT_SCALE) / 2, hullSize = size * TRADING_BOAT_SCALE;
  drawGalleyHull(c, boat, x + offset, y + offset, hullSize, time);
  drawGalleyRig(c, boat, x + offset, y + offset, hullSize);
}
export function galleyIconUrl(): string {
  if (icon) return icon;
  if (!full) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false;
  c.drawImage(full, 0, 32, 32, 32, 0, 0, 64, 64);
  return icon = canvas.toDataURL();
}
