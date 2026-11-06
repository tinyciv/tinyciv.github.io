/** Shade's unused native Miniworld shop with potion jars, cropped unchanged. */
export const HEALER_SHACK_SPRITE = { width: 16, height: 16, groundAnchor: [8, 16] } as const;
let shack: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

/** The square native sprite is also the building and Traditional Medicine icon. */
export function healerShackIconUrl(): string {
  return `${import.meta.env.BASE_URL}assets/miniworld/Healers-Shack.png`;
}

export function loadHealerShackArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = healerShackIconUrl();
    await image.decode();
    if (image.naturalWidth !== HEALER_SHACK_SPRITE.width || image.naturalHeight !== HEALER_SHACK_SPRITE.height)
      throw new Error('Invalid Miniworld healer’s shack cell.');
    shack = image;
  })();
}

export function drawHealerShack(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  if (!shack) return;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(shack, x, y, size, size);
  c.restore();
}
