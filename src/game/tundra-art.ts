import type { PunyPixels } from './puny-world';
let pixels: PunyPixels | undefined;
let loading: Promise<void> | undefined;
export const tundraPixels = () => pixels;
export function loadTundraArt(): Promise<void> {
  return loading ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.width !== 48 || image.height !== 48) { reject(new Error('Invalid tundra tile sheet')); return; }
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
      const c = canvas.getContext('2d')!; c.drawImage(image, 0, 0);
      pixels = c.getImageData(0, 0, 48, 48); resolve();
    };
    image.onerror = () => reject(new Error('Could not load tundra artwork'));
    image.src = `${import.meta.env.BASE_URL}assets/tundra/ground-1c.png`;
  });
}
