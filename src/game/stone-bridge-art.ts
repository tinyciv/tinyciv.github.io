import { runtimeArtUrl } from './runtime-art';
import type { RoadLinks } from './road-sprites';

/** Approved stone bridge set 2B (PixelLab object API, 16 px; provenance in
 * public/assets/bridges/stone-2b/provenance.json). Straight spans use these
 * pieces; junctions keep the older atlas drawing. */
const PIECES = ['lr-interior', 'lr-end-w', 'lr-end-e', 'ud-interior', 'ud-end-n', 'ud-end-s'] as const;
type Piece = typeof PIECES[number];
const images = new Map<Piece, HTMLImageElement>();
let loading: Promise<void> | undefined;

export function loadStoneBridgeArt(): Promise<void> {
    return loading ??= Promise.all(PIECES.map(piece => new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => { images.set(piece, image); resolve(); };
        image.onerror = () => reject(new Error(`Stone bridge piece ${piece} could not be loaded.`));
        image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/bridges/stone-2b/${piece}.png`);
    }))).then(() => undefined);
}

/** Pick the piece for a straight span. `banks` marks linked sides whose
 * neighbor is not another bridge tile, i.e. where the span meets land. */
export function stoneBridgePiece(links: RoadLinks, banks: RoadLinks | undefined): Piece | undefined {
    const horizontal = links.east || links.west, vertical = links.north || links.south;
    if (horizontal === vertical) return undefined;
    if (horizontal) {
        if (banks?.west && !banks.east) return 'lr-end-w';
        if (banks?.east && !banks.west) return 'lr-end-e';
        return 'lr-interior';
    }
    if (banks?.north && !banks.south) return 'ud-end-n';
    if (banks?.south && !banks.north) return 'ud-end-s';
    return 'ud-interior';
}

/** Draws into a 32 px tile with nearest-neighbor 2x scaling. Returns false
 * when the span shape has no piece (junctions) or art is not loaded. */
export function drawStoneBridge(c: CanvasRenderingContext2D, links: RoadLinks, banks: RoadLinks | undefined): boolean {
    const piece = stoneBridgePiece(links, banks), image = piece && images.get(piece);
    if (!image) return false;
    c.imageSmoothingEnabled = false;
    c.drawImage(image, 0, 0, 16, 16, 0, 0, 32, 32);
    return true;
}
