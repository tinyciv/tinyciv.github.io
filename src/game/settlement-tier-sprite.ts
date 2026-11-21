import { buildingFactionColor, buildingFactionShade } from './puny-building-art';
import { SETTLEMENT_SPRITE_WIDTH, SETTLEMENT_TIER_ART } from './settlement-art-layout';
import { runtimeArtUrl } from './runtime-art';

// Roof highlights outside the shared red ramp, identified in each source sprite.
const METROPOLIS_ROOF_ACCENTS: Readonly<Partial<Record<string, number>>> = {
    'metropolis-timber.webp': 0x954729,
    'metropolis-stone.webp': 0xef4a1e,
};
const art = new Map<string, { pixels: ImageData; roofs: number[]; factions: Map<string, HTMLCanvasElement> }>();
let loading: Promise<void> | undefined;

export function loadSettlementTierArt(): Promise<void> {
    return loading ??= Promise.all(Object.values(SETTLEMENT_TIER_ART).flatMap(Object.values).map(async ({ file, height }) => {
        const image = new Image();
        image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/buildings/settlement-tiers/${file}`);
        await image.decode();
        if (image.naturalWidth !== SETTLEMENT_SPRITE_WIDTH || image.naturalHeight !== height)
            throw new Error(`Invalid settlement tier artwork: ${file}`);
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, height), roofs: number[] = [];
        const accent = METROPOLIS_ROOF_ACCENTS[file];
        // The new sprites use saturated red roof tiles and warm brown timber.
        // Keep the dark roof edges and brown timber in their original palette.
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
            const red = pixels.data[offset], green = pixels.data[offset + 1], blue = pixels.data[offset + 2];
            const roofRed = red >= 103 && green <= red * .44 && red - green >= 57 && green - blue <= 43;
            if (pixels.data[offset + 3] && (roofRed || accent === (red << 16 | green << 8 | blue)))
                roofs.push(offset);
        }
        art.set(file, { pixels, roofs, factions: new Map() });
    })).then(() => undefined);
}

export function drawSettlementTier(c: CanvasRenderingContext2D, file: string, x: number, y: number, width: number, height: number, color: string): void {
    const source = art.get(file);
    if (!source) return;
    const rgb = buildingFactionColor(color), key = rgb.join(',');
    let canvas = source.factions.get(key);
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = source.pixels.width;
        canvas.height = source.pixels.height;
        const context = canvas.getContext('2d')!, tinted = context.createImageData(canvas.width, canvas.height);
        tinted.data.set(source.pixels.data);
        const shades = new Map<number, readonly number[]>();
        for (const offset of source.roofs) {
            const red = tinted.data[offset];
            let shade = shades.get(red);
            if (!shade) {
                shade = buildingFactionShade(rgb, Math.min(255, (red - 85) * 255 / 145));
                shades.set(red, shade);
            }
            tinted.data.set(shade, offset);
        }
        context.putImageData(tinted, 0, 0);
        source.factions.set(key, canvas);
    }
    c.drawImage(canvas, x, y, width, height);
}
