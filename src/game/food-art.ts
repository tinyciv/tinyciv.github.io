/** PixelHole's original wooden crate, trimmed to its native 12×10 silhouette. */
let crate: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadFoodArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}assets/pixelhole-overworld/Grain-Crate.png`;
    await image.decode();
    if (image.naturalWidth !== 12 || image.naturalHeight !== 10) throw new Error('Invalid grain crate sprite.');
    crate = image;
  })();
}

/** Bottom-center anchor in the renderer's native 32px tile plane. */
export function drawGrainCrate(c: CanvasRenderingContext2D, centerX: number, bottomY: number): void {
  if (!crate) return;
  c.save();
  c.imageSmoothingEnabled = false;
  c.drawImage(crate, Math.round(centerX) - 6, Math.round(bottomY) - 10);
  c.restore();
}
