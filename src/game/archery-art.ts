/** Native two-cell Miniworld archery range, without resampling source pixels. */
let range: HTMLImageElement | undefined;
let arrow: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
export function loadArcheryArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}assets/miniworld/Archery-Range.png`;
    await image.decode();
    if (image.naturalWidth !== 32 || image.naturalHeight !== 16) throw new Error('Invalid archery range artwork.');
    range = image;
    const projectile = new Image();
    projectile.src = `${import.meta.env.BASE_URL}assets/puny-world/Arrow.png`;
    await projectile.decode();
    arrow = projectile;
  })();
}
export function drawArcheryRange(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  if (!range) return;
  c.imageSmoothingEnabled = false; c.drawImage(range, x, y, size * 2, size);
}

/** Source arrow points down. The projectile caller's x-axis points at its target. */
export function drawArrow(c: CanvasRenderingContext2D, size: number): void {
  if (!arrow) return;
  c.save(); c.rotate(-Math.PI / 2); c.imageSmoothingEnabled = false;
  c.drawImage(arrow, -size * .28, -size * .28, size * .56, size * .56); c.restore();
}
