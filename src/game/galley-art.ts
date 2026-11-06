import type { Unit } from './types';
import { drawPerson } from './unit-sprites';

export const GALLEY_CELL = 32;
export const GALLEY_FRAME_SECONDS = .14;
export const GALLEY_ART_BOUNDS = { x: -16, y: -16, width: 64, height: 64 } as const;
export const GALLEY_PIVOT = { x: 16, y: 16 } as const;
// North, east, south, west: feet and mast attachment in the native32px cell.
const CAPTAIN_FEET = [[16, 26], [7, 16], [16, 10], [24, 16]] as const;
const RIG_ANCHORS = [[16, 20], [16, 15], [16, 23], [16, 15]] as const;
const HEADINGS = [-Math.PI / 2, 0, Math.PI / 2, Math.PI] as const;
type BoatPose = Pick<Unit, 'facing'> & Partial<Pick<Unit, 'moving'>>;
let hulls: HTMLImageElement | undefined, rigs: HTMLImageElement | undefined, full: HTMLImageElement | undefined;
let loading: Promise<void> | undefined, icon: string | undefined;
export function loadGalleyArt(): Promise<void> {
  return loading ??= Promise.all(['galley-hulls.png', 'galley-rigs.png', 'galley.png'].map(async (file, index) => {
    const image = new Image(); image.src = `${import.meta.env.BASE_URL}assets/naval/${file}`;
    await image.decode();
    if (image.naturalWidth !== (index === 1 ? 32 : 192) || image.naturalHeight !== 128) throw new Error(`Invalid galley artwork: ${file}`);
    if (index === 0) hulls = image; else if (index === 1) rigs = image; else full = image;
  })).then(() => undefined);
}
export const galleyHullImage = () => hulls;
export const galleyRigImage = () => rigs;

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
  if (!hulls) return;
  const pose = galleyPose(boat, time);
  c.save(); c.imageSmoothingEnabled = false;
  c.translate(x + size / 2, y + size / 2); c.rotate(pose.rotation);
  c.drawImage(hulls, ...pose.rect, -size, -size, size * 2, size * 2); c.restore();
}
export function drawGalleyRig(c: CanvasRenderingContext2D, boat: BoatPose, x: number, y: number, size: number): void {
  if (!rigs) return;
  const { row } = galleyPose(boat), offset = galleyAttachmentOffset(boat, 'rig');
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(rigs, 0, row * 32, 32, 32, x - size / 2 + offset.x * size / 32, y - size / 2 + offset.y * size / 32, size * 2, size * 2);
  c.restore();
}
export function drawGalleyPassenger(c: CanvasRenderingContext2D, boat: BoatPose, passenger: Unit,
  x: number, y: number, size: number, color: string, followTurn = true): void {
  const { row } = galleyPose(boat), feet = CAPTAIN_FEET[row];
  const offset = followTurn ? galleyAttachmentOffset(boat, 'captain') : { x: 0, y: 0 };
  c.save(); c.translate(x + (feet[0] * 2 - 16 + offset.x) * size / 32, y + (feet[1] * 2 - 16 + offset.y) * size / 32);
  c.scale(size / 32, size / 32); c.translate(-16, -27.2);
  drawPerson(c, { ...passenger, inside: false, moving: false, attackTime: 0, cargo: 0, facing: boat.facing }, 0, color);
  c.restore();
}
export function drawLeaderGalley(c: CanvasRenderingContext2D, boat: Unit, passenger: Unit | undefined,
  x: number, y: number, size: number, time: number, color: string): void {
  drawGalleyHull(c, boat, x, y, size, time);
  if (passenger) drawGalleyPassenger(c, boat, passenger, x, y, size, color);
  drawGalleyRig(c, boat, x, y, size);
}
export function galleyIconUrl(): string {
  if (icon) return icon;
  if (!full) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false;
  c.drawImage(full, 0, 32, 32, 32, 0, 0, 64, 64);
  return icon = canvas.toDataURL();
}
