let panel: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

/** Load before the first frame, so NativeArt never caches an empty panel. */
export function loadCityPanelArt(): Promise<void> {
    return loading ??= (async () => {
        const image = new Image();
        image.src = `${import.meta.env.BASE_URL}assets/ui/city-panel-walnut.png`;
        await image.decode();
        if (image.naturalWidth !== 103 || image.naturalHeight !== 20) throw new Error('Invalid city panel artwork.');
        panel = image;
    })();
}

/** Repeat/crop straight regions on whole native pixels instead of stretching
 * the wood or rails. The approved 6/5/6/5 corners remain at exactly 2×. */
export function drawCityPanelBackground(c: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
    if (!panel) return;
    const image = panel, scale = 2, left = 6, top = 5, right = 6, bottom = 5;
    const sw = image.naturalWidth, sh = image.naturalHeight, cw = sw - left - right, ch = sh - top - bottom;
    const L = left * scale, T = top * scale, R = right * scale, B = bottom * scale;
    const tile = (sx: number, sy: number, w: number, h: number, dx: number, dy: number, dw: number, dh: number) => {
        for (let oy = 0; oy < dh; oy += h * scale) for (let ox = 0; ox < dw; ox += w * scale) {
            const partWidth = Math.min(w * scale, dw - ox), partHeight = Math.min(h * scale, dh - oy);
            c.drawImage(image, sx, sy, partWidth / scale, partHeight / scale, dx + ox, dy + oy, partWidth, partHeight);
        }
    };
    c.save(); c.imageSmoothingEnabled = false;
    tile(left, top, cw, ch, x + L, y + T, width - L - R, height - T - B);
    tile(left, 0, cw, top, x + L, y, width - L - R, T);
    tile(left, sh - bottom, cw, bottom, x + L, y + height - B, width - L - R, B);
    tile(0, top, left, ch, x, y + T, L, height - T - B);
    tile(sw - right, top, right, ch, x + width - R, y + T, R, height - T - B);
    c.drawImage(image, 0, 0, left, top, x, y, L, T);
    c.drawImage(image, sw - right, 0, right, top, x + width - R, y, R, T);
    c.drawImage(image, 0, sh - bottom, left, bottom, x, y + height - B, L, B);
    c.drawImage(image, sw - right, sh - bottom, right, bottom, x + width - R, y + height - B, R, B);
    c.restore();
}
