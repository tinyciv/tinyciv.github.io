/** The same alpha-shaped halo is used for nearby buildings and resources. */
export function silhouetteOutline(sprite: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = sprite.width; canvas.height = sprite.height;
  const outline = canvas.getContext('2d')!;
  for (const [radius, opacity, highlight] of [[5, .3, false], [3, 1, false], [1, .4, true]] as const) {
    const ring = document.createElement('canvas'); ring.width = canvas.width; ring.height = canvas.height;
    const mask = ring.getContext('2d')!;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++)
      if (dx * dx + dy * dy <= radius * radius) mask.drawImage(sprite, dx, dy);
    mask.globalCompositeOperation = 'destination-out'; mask.drawImage(sprite, 0, 0);
    mask.globalCompositeOperation = 'source-in'; mask.fillStyle = highlight ? '#eef8ff' : color;
    mask.fillRect(0, 0, ring.width, ring.height);
    outline.globalAlpha = opacity; outline.drawImage(ring, 0, 0);
  }
  return canvas;
}
