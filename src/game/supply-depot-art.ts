/** Exact, unmodified horizontal Puny World Medieval sawmill. */
let image: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
export function loadSupplyDepotArt(): Promise<void> {
  return loading ??= (async () => {
    const source = new Image();
    source.src = `${import.meta.env.BASE_URL}assets/medieval/Supply-Depot.png`;
    await source.decode();
    if (source.naturalWidth !== 32 || source.naturalHeight !== 16) throw new Error('Invalid supply depot artwork.');
    image = source;
  })();
}
export function drawSupplyDepot(c: CanvasRenderingContext2D, x: number, y: number, tileSize: number): void {
  if (!image) return;
  c.imageSmoothingEnabled = false;
  c.drawImage(image, x, y, tileSize * 2, tileSize);
}
