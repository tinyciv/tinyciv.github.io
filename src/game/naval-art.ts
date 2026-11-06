import type { Building, Unit } from './types';
import { dockFootprint } from './dock';
import { loadGalleyArt } from './galley-art';

let house: HTMLImageElement | undefined, jetty: HTMLImageElement | undefined, sailboat: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
let dockIcon: string | undefined;

/** Original PixelHole pixels. Only the boat's baked cyan foam is removed. */
export function loadNavalArt(): Promise<void> {
  return loading ??= Promise.all([loadGalleyArt(), ...['pixelhole-overworld/Dock-House.png', 'pixelhole-overworld/Dock-Jetty.png', 'pixelhole-overworld/Sailboat.png'].map(async (file, index) => {
    const image = new Image(); image.src = `${import.meta.env.BASE_URL}assets/${file}`;
    await image.decode();
    if (image.naturalWidth !== 16 || image.naturalHeight !== (index === 1 ? 20 : 16)) throw new Error(`Invalid naval sprite: ${file}`);
    if (index === 0) house = image; else if (index === 1) jetty = image; else sailboat = image;
  })]).then(() => {});
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
export function dockIconUrl(): string {
  if (dockIcon) return dockIcon;
  if (!house || !jetty) return '';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  drawDock(canvas.getContext('2d')!, { dockFacing: 2 }, 16, 6, 32);
  return dockIcon = canvas.toDataURL();
}
