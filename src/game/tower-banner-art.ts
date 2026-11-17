/** Both approved tower sprites share these exact two banner colors. Matching
 * authored palette entries preserves every wood, stone and outline pixel. */
const canvases = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>();
export function towerBannerImage(source: HTMLImageElement, faction: string): HTMLImageElement | HTMLCanvasElement {
  if (!/^#[0-9a-f]{6}$/i.test(faction)) return source;
  let variants = canvases.get(source);
  if (!variants) { variants = new Map(); canvases.set(source, variants); }
  const previous = variants.get(faction); if (previous) return previous;
  const canvas = document.createElement('canvas'); canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
  const context = canvas.getContext('2d')!; context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height), data = pixels.data;
  const rgb = [1, 3, 5].map(offset => parseInt(faction.slice(offset, offset + 2), 16));
  for (let i = 0; i < data.length; i += 4) {
    const light = data[i] === 203 && data[i + 1] === 56 && data[i + 2] === 27;
    const dark = data[i] === 129 && data[i + 1] === 47 && data[i + 2] === 39;
    if (!data[i + 3] || !light && !dark) continue;
    for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.round(rgb[channel] * (dark ? 129 / 203 : 1));
  }
  context.putImageData(pixels, 0, 0); variants.set(faction, canvas); return canvas;
}
