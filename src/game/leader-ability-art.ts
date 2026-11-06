/** Tiny native-pixel additions to the existing worker, as requested: brown helmet and hammer. */
export function drawEngineerEquipment(c: CanvasRenderingContext2D, facing: number, working = false): void {
  const left = Math.cos(facing) < -.2, x = left ? 7 : 22, y = working ? 16 : 20;
  c.fillStyle = '#322319'; c.fillRect(10, 7, 12, 6);
  c.fillStyle = '#79522f'; c.fillRect(12, 6, 8, 5); c.fillRect(10, 10, 12, 2);
  c.fillStyle = '#b88c54'; c.fillRect(12, 6, 8, 2);
  c.fillStyle = '#3e2b1c'; c.fillRect(x, y, 2, 9);
  c.fillStyle = '#b88c54'; c.fillRect(x, y, 1, 8);
  c.fillStyle = '#2d3332'; c.fillRect(x - 3, y - 3, 8, 5);
  c.fillStyle = '#b9c1b6'; c.fillRect(x - 2, y - 2, 6, 3);
  c.fillStyle = '#e4e5d6'; c.fillRect(x - 2, y - 2, 6, 1);
}
export function drawBraceShield(c: CanvasRenderingContext2D, size: number): void {
  const p = Math.max(1, Math.round(size / 18));
  c.strokeStyle = '#ffffff'; c.lineWidth = p;
  c.beginPath(); c.moveTo(-3 * p, -4 * p); c.lineTo(3 * p, -4 * p); c.lineTo(3 * p, 0);
  c.lineTo(0, 3 * p); c.lineTo(-3 * p, 0); c.closePath(); c.stroke();
}
