import { drawPunyBuildingRegion } from './puny-building-art';

/** All village tents use the original Puny World artwork. */
export const VILLAGE_TENT_RECT = [64, 416, 16, 16] as const;

export function drawVillageTent(c: CanvasRenderingContext2D, x: number, y: number, size: number, color = '#ffffff'): void {
  drawPunyBuildingRegion(c, VILLAGE_TENT_RECT, x, y, size, size, color);
}
