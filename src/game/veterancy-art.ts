/** Small code-native emblems share the unit artwork's deliberately coarse pixel grid. */
export const THUNDERBOLT_VARIANTS = [
  { id: '1A', name: 'Classic bolt', description: 'A clear gold silhouette with a dark one-pixel edge.',
    pixels: ['....22.', '...112.', '..111..', '.111...', '111111.', '...111.', '..111..', '..11...', '.11....', '.1.....', '1......'],
    palette: ['#d39b3b', '#efd069', '#fff2ad'] },
  { id: '1B', name: 'Tall strike', description: 'A narrow ivory-gold flash with a longer tapered tip.',
    pixels: ['....2.', '...22.', '...12.', '..11..', '..11..', '.1111.', '11111.', '...11.', '..11..', '..1...', '.11...', '.1....', '1.....'],
    palette: ['#d3a748', '#f4db83', '#fff5c5'] },
  { id: '2A', name: 'Heavy bolt', description: 'A compact, broad shape for the strongest small-scale contrast.',
    pixels: ['....222.', '...1111.', '..1111..', '.1111...', '11111111', '..11111.', '..1111..', '.111....', '11......', '1.......'],
    palette: ['#ce9235', '#edc85e', '#fff0a2'] },
  { id: '2B', name: 'Forked flash', description: 'A branching strike with a more energetic silhouette.',
    pixels: ['....22...', '...112...', '..111....', '.111..2..', '1111112..', '...1111..', '..111.11.', '..11...11', '.11....1.', '.1.......', '1........'],
    palette: ['#ce963b', '#efd069', '#fff0a4'] },
  { id: '3A', name: 'Bright core', description: 'A pale center framed by deeper amber for a polished gold look.',
    pixels: ['....22.', '...122.', '..122..', '.122...', '011110.', '...120.', '..120..', '..10...', '.10....', '.1.....', '1......'],
    palette: ['#b87b2e', '#e8bc55', '#fff4cf'] },
  { id: '3B', name: 'Bronze insignia', description: 'A gold strike mounted on a small stepped bronze badge.',
    pixels: ['...00000...', '..0000220..', '.000012200.', '.000122000.', '00012200000', '00111111000', '00000112000', '.000112000.', '.001120000.', '..0110000..', '...10000...'],
    palette: ['#7d562c', '#edc367', '#fff0a9'] },
] as const;

export type ThunderboltVariant = typeof THUNDERBOLT_VARIANTS[number]['id'];
export const DEFAULT_THUNDERBOLT: ThunderboltVariant = '3A';

export function drawThunderbolt(c: CanvasRenderingContext2D, x: number, y: number, pixel = 1, variant: ThunderboltVariant = DEFAULT_THUNDERBOLT): void {
  const option = THUNDERBOLT_VARIANTS.find(candidate => candidate.id === variant) ?? THUNDERBOLT_VARIANTS[0];
  const scale = Math.max(.5, pixel), left = Math.round(x), top = Math.round(y);
  c.save(); c.imageSmoothingEnabled = false;
  c.fillStyle = '#3c321e';
  for (let row = 0; row < option.pixels.length; row++) for (let column = 0; column < option.pixels[row].length; column++) {
    if (option.pixels[row][column] === '.') continue;
    c.fillRect(left + (column - 1) * scale, top + row * scale, scale * 3, scale);
    c.fillRect(left + column * scale, top + (row - 1) * scale, scale, scale * 3);
  }
  for (let row = 0; row < option.pixels.length; row++) for (let column = 0; column < option.pixels[row].length; column++) {
    const value = option.pixels[row][column];
    if (value === '.') continue;
    c.fillStyle = option.palette[Number(value)];
    c.fillRect(left + column * scale, top + row * scale, scale, scale);
  }
  c.restore();
}

/** Close beside the helmet, below health bars and clear of the face. */
export function drawRankMarker(c: CanvasRenderingContext2D, rank: number, x: number, y: number, size: number, bolt: ThunderboltVariant = DEFAULT_THUNDERBOLT): void {
  if (!rank) return;
  if (rank >= 4) {
    drawThunderbolt(c, x + size * .74, y + size * .16, size / 40, bolt);
    return;
  }
  c.save(); c.lineJoin = 'miter';
  const left = x + size * .74, top = y + size * .43;
  for (let i = 0; i < rank; i++) {
    c.beginPath(); c.moveTo(left, top - i * size * .10); c.lineTo(left + size * .09, top - size * .06 - i * size * .10); c.lineTo(left + size * .18, top - i * size * .10);
    c.strokeStyle = '#493813'; c.lineWidth = Math.max(2.5, size * .085); c.stroke();
    c.strokeStyle = '#efd069'; c.lineWidth = Math.max(1.3, size * .045); c.stroke();
  }
  c.restore();
}
