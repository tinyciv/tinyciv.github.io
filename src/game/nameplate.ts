import { runtimeArtUrl } from './runtime-art';
import { gameFont } from './game-font';

export const NAMEPLATE_HEIGHT = 40;
const FONT_SIZE = 28;
const LEFT = 32, RIGHT = 12;
let artwork: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
let measure: CanvasRenderingContext2D | undefined;
const widths = new Map<string, number>();
const banners = new Map<string, HTMLCanvasElement>();

/** Await during art loading so the renderer never caches an empty frame. */
export function loadNameplateArt(): Promise<void> {
    return loading ??= (async () => {
        const image = new Image();
        image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/ui/naval/ship-nameplate.png`);
        await image.decode();
        artwork = image;
    })();
}

/** Fonts are ready before rendering; measure each distinct name only once. */
export function nameplateWidth(name: string): number {
    const cached = widths.get(name);
    if (cached !== undefined) return cached;
    measure ??= document.createElement('canvas').getContext('2d')!;
    measure.font = gameFont(FONT_SIZE);
    const width = Math.ceil((LEFT + 8 + measure.measureText(name).width + RIGHT) / 2) * 2;
    widths.set(name, width);
    return width;
}

/** Recolor only the generated ribbon's red cloth. Keep its neutral highlight,
 * outline and plaque pixels intact; each faction's cap is prepared once. */
function factionBanner(color: string): HTMLCanvasElement {
    const cached = banners.get(color);
    if (cached) return cached;
    const canvas = document.createElement('canvas'); canvas.width = LEFT; canvas.height = NAMEPLATE_HEIGHT;
    const c = canvas.getContext('2d')!;
    c.drawImage(artwork!, 0, 0, LEFT, NAMEPLATE_HEIGHT, 0, 0, LEFT, NAMEPLATE_HEIGHT);
    const pixels = c.getImageData(0, 0, LEFT, NAMEPLATE_HEIGHT);
    const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
    for (let y = 7; y < 28; y++) for (let x = 9; x < 23; x++) {
        const offset = (y * LEFT + x) * 4;
        const red = pixels.data[offset], green = pixels.data[offset + 1], blue = pixels.data[offset + 2];
        if (red < 2 * green || red < 2 * blue || red - green < 24) continue;
        const shade = red / 164;
        for (let channel = 0; channel < 3; channel++)
            pixels.data[offset + channel] = Math.min(255, Math.round(rgb[channel] * shade));
    }
    c.putImageData(pixels, 0, 0); banners.set(color, canvas);
    return canvas;
}

/** Centered, screen-sized plaque. Keep the banner and end caps at native size;
 * repeat a straight strip so longer names never stretch the border pixels. */
export function drawNameplate(c: CanvasRenderingContext2D, name: string, width: number, color: string): void {
    if (!artwork) return;
    const x = -width / 2, y = -NAMEPLATE_HEIGHT / 2;
    const height = NAMEPLATE_HEIGHT, sourceWidth = artwork.naturalWidth;
    c.save(); c.imageSmoothingEnabled = false;
    c.drawImage(factionBanner(color), x, y);
    for (let offset = LEFT; offset < width - RIGHT; offset += 2) {
        const part = Math.min(2, width - RIGHT - offset);
        c.drawImage(artwork, 80, 0, part, height, x + offset, y, part, height);
    }
    c.drawImage(artwork, sourceWidth - RIGHT, 0, RIGHT, height, x + width - RIGHT, y, RIGHT, height);
    c.font = gameFont(FONT_SIZE); c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillStyle = '#faf3df'; c.fillText(name, x + LEFT + 8, 1);
    c.restore();
}
