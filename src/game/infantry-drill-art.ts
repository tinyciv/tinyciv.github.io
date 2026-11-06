/** Screen overlay at the same 32-pixel cell scale as the world. A broad solid
 * silhouette stays readable over both units and detailed terrain. */
export function drawInfantryAdvanceArrow(c: CanvasRenderingContext2D): void {
  c.beginPath(); c.moveTo(0, -4); c.lineTo(25, -4); c.lineTo(25, -12);
  c.lineTo(44, 0); c.lineTo(25, 12); c.lineTo(25, 4); c.lineTo(0, 4); c.closePath();
  c.fillStyle = '#ffffff'; c.fill();
}
