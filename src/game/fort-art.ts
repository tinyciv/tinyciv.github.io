/** User-selected Fort image, preserved unchanged with its original blue roof. */
export const FORT_SPRITE = {
  width: 1254, height: 1254,
  // Exclude transparent canvas padding and faint stray pixels outside the fort.
  source: [144, 156, 968, 974],
  groundAnchor: [628, 1130],
} as const;
let fort: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadFortArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}assets/buildings/fort.png`;
    await image.decode();
    if (image.naturalWidth !== FORT_SPRITE.width || image.naturalHeight !== FORT_SPRITE.height)
      throw new Error('Invalid Fort artwork dimensions.');
    fort = image;
  })();
}

/** Bottom-center anchoring keeps the visible foundation on its two-cell plot. */
export function drawFort(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  if (!fort) return;
  const [sx, sy, width, height] = FORT_SPRITE.source;
  const scale = size / Math.max(width, height), drawnWidth = width * scale, drawnHeight = height * scale;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(fort, sx, sy, width, height, x + (size - drawnWidth) / 2, y + size - drawnHeight, drawnWidth, drawnHeight);
  c.restore();
}
