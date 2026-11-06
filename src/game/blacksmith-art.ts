/** Shade's one-cell Miniworld smithy, cropped unchanged from Wood/Workshops. */
export const BLACKSMITH_SPRITE = { width: 16, height: 16 } as const;
let smithy: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadBlacksmithArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}assets/miniworld/Blacksmith.png`;
    await image.decode();
    if (image.naturalWidth !== 16 || image.naturalHeight !== 16)
      throw new Error('Invalid Miniworld blacksmith cell.');
    smithy = image;
  })();
}

export function drawBlacksmith(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  if (!smithy) return;
  c.imageSmoothingEnabled = false;
  c.drawImage(smithy, x, y, size, size);
}
