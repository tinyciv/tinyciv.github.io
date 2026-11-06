import type { Building, HouseStyle } from './types';
import { drawPuny, loadPunyWorld, punyWorldImage } from './puny-world';
import { drawPunyBuildingTile, drawPunyBuildingRegion, nativeHouseTier, NATIVE_BUILDINGS } from './puny-building-art';
import { drawHouseVariant } from './house-variant-art';

/** Compatibility entry points for callers of the former generated art set. */
export const HOUSE_STYLES: readonly HouseStyle[] = ['shack', 'hovel', 'cottage', 'villa'];
export const loadWoodenBuildingArt = loadPunyWorld;
export const woodenBuildingArtReady = (): boolean => !!punyWorldImage();
export function houseStyleFor(building: Pick<Building, 'id' | 'houseStyle' | 'houseLevel'>): HouseStyle {
  return HOUSE_STYLES[nativeHouseTier(building) - 1];
}

export function drawWoodenHouse(c: CanvasRenderingContext2D, building: Pick<Building, 'id' | 'houseStyle' | 'houseLevel'>, x = 0, y = 0, size = 32, color = '#3988ff'): void {
  if (drawHouseVariant(c, building, x, y, size, color)) return;
  const source = NATIVE_BUILDINGS.houses[nativeHouseTier(building)];
  drawPunyBuildingTile(c, source.column, source.row, x, y, size, size, color);
}

/** Mounted platforms retain short timber brackets; the wall supports the rest.
 * Crop the original posts instead of shrinking their native pixel thickness. */
export function drawWoodenTower(c: CanvasRenderingContext2D, x = 0, y = -24, size = 32, color = '#3988ff', mounted = false): void {
  c.save(); c.translate(x, y + size * 24 / 32); c.scale(size / 32, size / 32);
  for (const post of NATIVE_BUILDINGS.woodenTower.posts) {
    const [sx, sy, sw, sh] = post.rect, [dx, dy, dw, dh] = post.destination;
    const height = mounted ? 5 : sh;
    drawPuny(c, sx, sy, sw, height, dx, dy, dw, dh * height / sh);
  }
  const platform = NATIVE_BUILDINGS.woodenTower.platform;
  drawPunyBuildingRegion(c, platform.rect, ...platform.destination, color);
  c.restore();
}

/** The caller clips road passages through these original timber gate posts. */
export function drawPalisadeGate(c: CanvasRenderingContext2D, passage: 'ns' | 'ew', x = 0, y = 0, size = 32): void {
  c.save(); c.translate(x, y); c.scale(size / 32, size / 32);
  if (passage === 'ns') {
    drawPuny(c, 22 * 16, 26 * 16, 4, 16, 4, 0, 8, 32);
    drawPuny(c, 22 * 16, 26 * 16, 4, 16, 20, 0, 8, 32);
  } else {
    drawPuny(c, 22 * 16, 29 * 16, 16, 4, 0, 2, 32, 8);
    drawPuny(c, 22 * 16, 29 * 16, 16, 4, 0, 22, 32, 8);
  }
  c.restore();
}

/** The approved narrow covered well is an original static 16×16 sprite. */
export function drawCoveredWell(c: CanvasRenderingContext2D, x = 0, y = 0, size = 32, _time = 0, color = '#3988ff'): void {
  drawPunyBuildingTile(c, NATIVE_BUILDINGS.well.column, NATIVE_BUILDINGS.well.row, x, y, size, size, color);
}

export function woodenHouseIconUrl(style: HouseStyle = 'shack', color = '#3988ff'): string {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  drawWoodenHouse(canvas.getContext('2d')!, { id: 0, houseStyle: style }, 0, 0, 32, color);
  return canvas.toDataURL();
}
export function palisadeGateIconUrl(): string {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  drawPalisadeGate(canvas.getContext('2d')!, 'ns');
  return canvas.toDataURL();
}
