import type { RoadLinks } from './road-sprites';
import { wallConnectionMask } from './wall-sprites';

/** Lossless crop from the purchased Puny World Medieval atlas, shared with
 * the approved Blackroot preview. Rectangles remain at their native 2× scale. */
export const PALISADE_TILES = {
  horizontal: [32, 48, 16, 16], vertical: [0, 16, 16, 16],
  eastEnd: [16, 48, 16, 16], westEnd: [48, 48, 16, 16], pier: [0, 48, 16, 16],
  northEnd: [0, 32, 16, 16], southEnd: [0, 0, 16, 16],
  southeast: [16, 0, 16, 16], southwest: [48, 0, 16, 16],
  northeast: [16, 32, 16, 16], northwest: [48, 32, 16, 16],
  openGateNS: [144, 0, 16, 16], openGateEW: [144, 16, 16, 16],
  closedGateNS: [64, 0, 16, 16], closedGateEW: [64, 16, 16, 16],
} as const;
let sheet: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
export function loadPalisadeArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}assets/puny-medieval/palisades.png`;
    await image.decode();
    if (image.naturalWidth !== 160 || image.naturalHeight !== 64) throw new Error('Invalid Puny Medieval palisade sheet.');
    sheet = image;
  })();
}

export function drawPalisade(c: CanvasRenderingContext2D, links: RoadLinks, gate?: RoadLinks): void {
  if (!sheet) return;
  c.save(); c.imageSmoothingEnabled = false;
  // Wall runs, corners and every junction stay inside one map tile.
  c.beginPath(); c.rect(0, 0, 32, 32); c.clip();
  const mask = wallConnectionMask(links), tiles = PALISADE_TILES;
  const draw = (source: readonly [number, number, number, number]) => c.drawImage(sheet!, ...source, 0, 0, 32, 32);
  if (gate) {
    const passage = wallConnectionMask(gate) || (mask & 5 && !(mask & 10) ? 10 : 5);
    // Keep the authored timber bars and fittings. Cutting out the road would
    // erase the gate itself; access is controlled by ownership, not this art.
    // Mixed road branches use the wall's axis to orient the complete frame.
    const eastWest = !(passage & 5) || !!(passage & 10) && !!(mask & 5) && !(mask & 10);
    draw(eastWest ? tiles.closedGateEW : tiles.closedGateNS);
  } else {
    // The bottom source row contains pier / left cap / run / right cap.
    // Use an end cap only when its opposite arm is connected; cliff and gate
    // connections already arrive in this mask and therefore remain open seams.
    const source = mask === 0 ? tiles.pier : mask === 2 ? tiles.eastEnd : mask === 8 ? tiles.westEnd
      : mask === 1 ? tiles.northEnd : mask === 4 ? tiles.southEnd : mask === 3 ? tiles.northeast : mask === 6 ? tiles.southeast
      : mask === 9 ? tiles.northwest : mask === 12 ? tiles.southwest
      : mask === 5 ? tiles.vertical : tiles.horizontal;
    draw(source);
    if (mask === 7 || mask === 11 || mask === 13 || mask === 14 || mask === 15) {
      // The pack has no T/cross tile. Join unscaled native timber directions
      // inside this cell; every branch reaches its connected tile edge.
      c.save(); c.beginPath();
      const x = mask === 13 ? 16 : mask === 15 ? 8 : 0;
      c.rect(x, mask === 14 ? 16 : 0, 16, mask === 11 || mask === 14 ? 16 : 32); c.clip();
      draw(tiles.vertical); c.restore();
    }
  }
  c.restore();
}
