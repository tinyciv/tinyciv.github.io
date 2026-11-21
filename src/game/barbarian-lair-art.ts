import { runtimeArtUrl } from './runtime-art';

let image: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadBarbarianLairArt(): Promise<void> {
  return loading ??= (async () => {
    const source = new Image();
    source.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/buildings/barbarian-lair.png`);
    await source.decode();
    if (source.naturalWidth !== 48 || source.naturalHeight !== 48) throw new Error('Invalid barbarian lair artwork.');
    image = source;
  })();
}

export function drawBarbarianLair(context: CanvasRenderingContext2D, size: number): void {
  if (image) context.drawImage(image, 0, 0, size, size);
}
