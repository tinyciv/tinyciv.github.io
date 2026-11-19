const CELL = 16;
const atlases = [
  { file: 'snow.webp', columns: 16, rows: 18 },
  { file: 'sea-ice.webp', columns: 12, rows: 8 },
] as const;
let images: HTMLImageElement[] | undefined;
let loading: Promise<void> | undefined;

export function loadFrostArt(): Promise<void> {
  return loading ??= Promise.all(atlases.map(({ file, columns, rows }) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth === columns * CELL && image.naturalHeight === rows * CELL) resolve(image);
      else reject(new Error(`Invalid frost atlas: ${file}`));
    };
    image.onerror = () => reject(new Error(`Could not load frost atlas: ${file}`));
    image.src = `${import.meta.env.BASE_URL}assets/winter/${file}`;
  }))).then(loaded => { images = loaded; });
}

export function drawFrostTile(c: CanvasRenderingContext2D, seaIce: boolean, frame: number, size: number): void {
  if (!images) return;
  const cell = frame - 1, index = Number(seaIce), { columns } = atlases[index];
  c.drawImage(images[index], cell % columns * CELL, Math.floor(cell / columns) * CELL,
    CELL, CELL, 0, 0, size, size);
}
