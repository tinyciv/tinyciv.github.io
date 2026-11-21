import { runtimeArtUrl } from './runtime-art';

export const FERTILITY_GRASS_CELL = 16;
export const FERTILITY_GRASS_VARIANTS = 9;
let atlas: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadFertilityGrassArt(): Promise<void> {
    return loading ??= (async () => {
        const image = new Image();
        image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/vegetation/fertility/grass-overlay.png`);
        await image.decode();
        if (image.naturalWidth !== FERTILITY_GRASS_CELL * FERTILITY_GRASS_VARIANTS || image.naturalHeight !== FERTILITY_GRASS_CELL * 3)
            throw new Error('Invalid fertility grass atlas');
        atlas = image;
    })();
}

export function fertilityGrassImage(): HTMLImageElement | undefined {
    return atlas;
}
