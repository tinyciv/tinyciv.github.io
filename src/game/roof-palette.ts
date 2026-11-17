/** Change team hue while preserving the artist's separate light/shadow bands.
 * The former multiplier clipped bright reds to 255, flattening shaded roofs. */
export function roofColor(r: number, g: number, b: number, color: string): [number, number, number] {
  if (!(r > 90 && r > g * 1.45 && r > b * 1.3 && b >= g * .65) || !/^#[a-f\d]{6}$/i.test(color)) return [r, g, b];
  const target = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
  const max = Math.max(...target), min = Math.min(...target), d = max - min;
  let hue = d === 0 ? 0 : max === target[0] ? ((target[1] - target[2]) / d + 6) % 6
    : max === target[1] ? (target[2] - target[0]) / d + 2 : (target[0] - target[1]) / d + 4;
  hue /= 6;
  const sourceMax = Math.max(r, g, b) / 255, sourceMin = Math.min(r, g, b) / 255;
  const light = (sourceMax + sourceMin) / 2;
  const saturation = (sourceMax - sourceMin) / Math.max(.00001, 1 - Math.abs(2 * light - 1));
  const targetSaturation = d / Math.max(.00001, 1 - Math.abs(max + min - 1));
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation * Math.min(1, targetSaturation / .7);
  const x = chroma * (1 - Math.abs((hue * 6) % 2 - 1)), m = light - chroma / 2;
  const rgb = hue < 1/6 ? [chroma,x,0] : hue < 2/6 ? [x,chroma,0] : hue < 3/6 ? [0,chroma,x]
    : hue < 4/6 ? [0,x,chroma] : hue < 5/6 ? [x,0,chroma] : [chroma,0,x];
  return rgb.map(c => Math.round((c + m) * 255)) as [number, number, number];
}
export function tintRoof(pixels: ImageData, color: string, rows = pixels.height): void {
  for (let i = 0; i < pixels.width * Math.min(rows, pixels.height) * 4; i += 4) {
    const rgb = roofColor(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2], color);
    pixels.data.set(rgb, i);
  }
}
