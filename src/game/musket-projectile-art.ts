/** Shared by the world renderer and the firing-range Storybook preview. */
export function drawMusketBullet(context: CanvasRenderingContext2D, tileSize: number): void {
  context.fillStyle = '#ffe7ad';
  context.fillRect(-tileSize * .09, -2, tileSize * .18, 4);
}
