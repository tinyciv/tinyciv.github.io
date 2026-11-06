import { drawPuny } from './puny-world';

/** The native single-trunk palm, including its original transparent shadow. */
export const PUNY_PALM_RECT = [48, 448, 16, 16] as const;

export function drawPalm(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  c.save();
  c.imageSmoothingEnabled = false;
  drawPuny(c, ...PUNY_PALM_RECT, x, y, size, size);
  c.restore();
}
