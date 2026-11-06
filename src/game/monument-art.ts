/** Original armored stone statue from Shade's CC0 Puny Dungeon atlas.
 * Tile 491 also appears eight times in the creator's sample-map2.tmj. */
export const MONUMENT_SPRITE = { x: 368, y: 288, width: 16, height: 16 };
let atlas: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadMonumentArt(): Promise<void> {
    return loading ??= new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => { atlas = image; resolve(); };
        image.onerror = () => reject(new Error('Puny monument statue could not be loaded.'));
        image.src = `${import.meta.env.BASE_URL}assets/puny-world/dungeon.png`;
    });
}

/** Keep the complete native silhouette and neutral stone palette. */
export function drawMonument(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    if (!atlas) return;
    const sprite = MONUMENT_SPRITE;
    c.imageSmoothingEnabled = false;
    c.drawImage(atlas, sprite.x, sprite.y, sprite.width, sprite.height, x, y, size, size);
}
