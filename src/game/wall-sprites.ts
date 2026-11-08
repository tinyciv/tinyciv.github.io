import { drawPuny } from './puny-world';
import type { NativeBuildingRect } from './puny-building-art';
import type { RoadLinks } from './road-sprites';

/** Cardinal bits match the creator's sample-map wall layout: N E S W. */
export function wallConnectionMask(links: RoadLinks): number {
  return Number(links.north) | Number(links.east) << 1 | Number(links.south) << 2 | Number(links.west) << 3;
}
const cell = (column: number, row: number): NativeBuildingRect => [column * 16, row * 16, 16, 16];
export const PUNY_WALL_TILES = {
  horizontal: cell(19, 26), vertical: cell(18, 27),
  southeast: cell(18, 26), southwest: cell(20, 26),
  northeast: cell(18, 28), northwest: cell(20, 28),
  eastEnd: cell(14, 29), westEnd: cell(15, 29), pier: cell(17, 29),
  openGate: cell(19, 29), closedGate: cell(18, 29), barredGate: cell(20, 29),
} as const;

/** Native wall cells keep their authored widths and 2× pixel scale. The four
 * corners, runs and gate frames are verified against Shade's samplemap5. The
 * pack has no dedicated T/cross cells: a native closed pier joins those arms.
 * Unlike the former shrunken center turret, that pier reaches the tile seams. */
export function drawPunyWall(c: CanvasRenderingContext2D, links: RoadLinks, gate: RoadLinks | undefined): void {
  c.imageSmoothingEnabled = false;
  const mask = wallConnectionMask(links), tiles = PUNY_WALL_TILES;
  if (gate) {
    // The native portcullis makes this a visible gate rather than an empty arch.
    // Roads pass behind it; ownership controls passage independently of the art.
    drawPuny(c, ...tiles.barredGate, 0, 0, 32, 32);
  } else if (mask === 1 || mask === 4) {
    drawPuny(c, ...tiles.vertical, 0, 0, 32, 32);
    // Close only the free end of a vertical run with native cap pixels.
    const cap = mask === 1 ? tiles.northeast : tiles.southeast;
    const sy = cap[1] + (mask === 1 ? 8 : 0), y = mask === 1 ? 16 : 0;
    drawPuny(c, cap[0], sy, 16, 8, 0, y, 32, 16);
  } else {
    const source = mask === 2 ? tiles.eastEnd : mask === 8 ? tiles.westEnd
      : mask === 5 ? tiles.vertical : mask === 10 ? tiles.horizontal
      : mask === 3 ? tiles.northeast : mask === 6 ? tiles.southeast
      : mask === 9 ? tiles.northwest : mask === 12 ? tiles.southwest : tiles.pier;
    drawPuny(c, ...source, 0, 0, 32, 32);
  }
}
