/** Individual 8FC ochre stones from the bundled LPC Rocks sheet; unchanged pixels. */
const sizes: readonly (readonly [number, number])[] = [[11, 6], [11, 7], [9, 7], [9, 7], [5, 4], [11, 7], [7, 4], [10, 8], [11, 7], [6, 4], [11, 6], [12, 8], [11, 7], [7, 5], [5, 4], [8, 5], [12, 8], [6, 4], [6, 4], [11, 7], [7, 6], [7, 4], [5, 4], [7, 4]];
let image: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
export function loadDesertStoneArt(): Promise<void> {
  return loading ??= new Promise((resolve, reject) => {
    const asset = new Image();
    asset.onload = () => { image = asset; resolve(); };
    asset.onerror = () => reject(new Error('Could not load desert stones'));
    asset.src = `${import.meta.env.BASE_URL}assets/desert-stones/ochre.png`;
  });
}
export function drawDesertStone(c: CanvasRenderingContext2D, variant: number, variation: number): void {
  if (!image) return;
  const [w, h] = sizes[variant % sizes.length];
  // Whole native pixel positions and 2× enlargement, contained within the tile.
  const x = Math.floor(variation * (17 - w)) * 2;
  const y = Math.floor(((variation * 7.13) % 1) * (17 - h)) * 2;
  c.imageSmoothingEnabled = false;
  c.drawImage(image, variant % sizes.length * 16, 0, w, h, x, y, w * 2, h * 2);
}
