import type { Building, Unit } from './types';
import { dockFootprint } from './dock';
import { drawPerson } from './unit-sprites';

let house: HTMLImageElement | undefined, jetty: HTMLImageElement | undefined, sailboat: HTMLImageElement | undefined, rowboat: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
let boatIcon: string | undefined, dockIcon: string | undefined;

/** Original PixelHole pixels. Only the boat's baked cyan foam is removed. */
export function loadNavalArt(): Promise<void> {
  return loading ??= Promise.all(['pixelhole-overworld/Dock-House.png', 'pixelhole-overworld/Dock-Jetty.png', 'pixelhole-overworld/Sailboat.png', 'miniworld/Fishing-Boat.png'].map(async (file, index) => {
    const image = new Image(); image.src = `${import.meta.env.BASE_URL}assets/${file}`;
    await image.decode();
    if (image.naturalWidth !== (index === 3 ? 32 : 16) || image.naturalHeight !== (index === 1 ? 20 : 16)) throw new Error(`Invalid naval sprite: ${file}`);
    if (index === 0) house = image; else if (index === 1) jetty = image; else if (index === 2) sailboat = image; else rowboat = image;
  })).then(() => {});
}

/** Bounds relative to the land anchor, in the ordinary 32px tile plane. */
export function dockArtBounds(building: Pick<Building, 'dockFacing'>) {
  switch (building.dockFacing ?? 2) {
    case 0: return { x: 0, y: -20, width: 32, height: 52 };
    case 1: return { x: 0, y: 0, width: 52, height: 32 };
    case 3: return { x: -20, y: 0, width: 52, height: 32 };
    default: return { x: 0, y: 0, width: 32, height: 52 };
  }
}

export function dockConstructionBounds(building: Pick<Building, 'dockFacing'>) {
  const bounds = dockFootprint(building);
  return { x: bounds.x * 32, y: bounds.y * 32, width: bounds.width * 32, height: bounds.height * 32 };
}

/** One jetty points toward water; the single house retains its upright view. */
export function drawDock(c: CanvasRenderingContext2D, building: Pick<Building, 'dockFacing'>, x: number, y: number, size: number): void {
  if (!house || !jetty) return;
  c.save(); c.imageSmoothingEnabled = false; c.translate(x, y); c.scale(size / 16, size / 16);
  c.save(); c.translate(8, 8); c.rotate(((building.dockFacing ?? 2) - 2) * Math.PI / 2); c.translate(-8, -8);
  c.drawImage(jetty, 0, 6); c.restore();
  c.drawImage(house, 0, 0); c.restore();
}

export function sailboatMirrored(unit: Pick<Unit, 'facing'>): boolean { return Math.cos(unit.facing) < -.01; }
/** Use the original horizontal hull and turn it continuously in the tile plane. */
export function rowboatArtFrame(_boat: Pick<Unit, 'facing'>): readonly [number, number, number, number] {
  return [16, 0, 16, 16];
}
/** The native hull/oars are centered one source pixel below the cell midpoint. */
export const ROWBOAT_PIVOT = { x: 16, y: 18 } as const;
export function drawRowboatHull(c: CanvasRenderingContext2D, boat: Pick<Unit, 'facing'>,
  x: number, y: number, size: number): void {
  if (!rowboat) return;
  c.save(); c.imageSmoothingEnabled = false;
  c.translate(x + size * ROWBOAT_PIVOT.x / 32, y + size * ROWBOAT_PIVOT.y / 32); c.rotate(boat.facing);
  c.drawImage(rowboat, ...rowboatArtFrame(boat), -size * ROWBOAT_PIVOT.x / 32, -size * ROWBOAT_PIVOT.y / 32, size, size);
  c.restore();
}
export function drawRowboatPassenger(c: CanvasRenderingContext2D, boat: Pick<Unit, 'facing'>, passenger: Unit,
  x: number, y: number, size: number, color: string): void {
  // Turn the hull underneath an upright, seated Leader. Never rotate his sprite
  // sideways or replay the hidden passenger's walking and attack animation.
  c.save(); c.translate(x + size * .5, y + size * .58); c.scale(size / 32 * .6, size / 32 * .6); c.translate(-16, -27.2);
  drawPerson(c, { ...passenger, inside: false, moving: false, attackTime: 0, cargo: 0, facing: boat.facing }, 0, color);
  c.restore();
}
export function drawLeaderRowboat(c: CanvasRenderingContext2D, boat: Unit, passenger: Unit | undefined,
  x: number, y: number, size: number, color: string): void {
  if (!rowboat) return;
  drawRowboatHull(c, boat, x, y, size);
  if (passenger) drawRowboatPassenger(c, boat, passenger, x, y, size, color);
}
/** Small automatic trading posts reuse the dock house's original pixels. The
 * clear bank in front remains the merchant's boarding/disembarkation point. */
export function drawRiverTradingPost(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  if (!house) return;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(house, x + size * .125, y, size * .75, size * .75);
  c.restore();
}
export function drawSailboat(c: CanvasRenderingContext2D, unit: Pick<Unit, 'facing'>, x: number, y: number, size: number): void {
  if (!sailboat) return;
  c.save(); c.imageSmoothingEnabled = false;
  c.translate(x + (sailboatMirrored(unit) ? size : 0), y); if (sailboatMirrored(unit)) c.scale(-1, 1);
  c.drawImage(sailboat, 0, 0, size, size); c.restore();
}
export function rowboatIconUrl(): string {
  if (boatIcon) return boatIcon;
  if (!rowboat) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d')!; context.imageSmoothingEnabled = false;
  context.drawImage(rowboat, 16, 0, 16, 16, 0, 0, 32, 32);
  return boatIcon = canvas.toDataURL();
}
export function dockIconUrl(): string {
  if (dockIcon) return dockIcon;
  if (!house || !jetty) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  drawDock(canvas.getContext('2d')!, { dockFacing: 2 }, 16, 6, 32);
  return dockIcon = canvas.toDataURL();
}
