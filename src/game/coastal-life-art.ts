import type { PixiScene } from './pixi-scene';

const SIZE = 16;
export const COASTAL_FRAME_COUNT = 8;
const ROW = { ripple: 0, foam: 1, wash: 2, gull: 3, heron: 4 } as const;
type CoastalArt = keyof typeof ROW;
let atlas: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadCoastalLifeArt(): Promise<void> {
    return loading ??= (async () => {
        const image = new Image();
        image.src = `${import.meta.env.BASE_URL}assets/effects/coastal-life/atlas.webp`;
        await image.decode();
        if (image.naturalWidth !== SIZE * COASTAL_FRAME_COUNT || image.naturalHeight !== SIZE * 5)
            throw new Error('Invalid coastal life artwork');
        atlas = image;
    })();
}

export function drawCoastalFrame(scene: PixiScene, kind: CoastalArt, frame: number, x: number, y: number,
    width: number, height: number, rotation: number, alpha: number, shadow = false): void {
    const image = atlas;
    if (!image || alpha <= 0) return;
    const picture = scene.art.paint(`coastal:${kind}:${frame}:${shadow}`, { x: 0, y: 0, width: SIZE, height: SIZE }, c => {
        c.drawImage(image, frame * SIZE, ROW[kind] * SIZE, SIZE, SIZE, 0, 0, SIZE, SIZE);
        if (shadow) {
            c.globalCompositeOperation = 'source-atop';
            c.fillStyle = '#203b42';
            c.fillRect(0, 0, SIZE, SIZE);
        }
    }, 1);
    const sprite = scene.image(picture.texture, x, y, width, height, alpha);
    sprite.anchor.set(.5);
    sprite.rotation = rotation;
}
