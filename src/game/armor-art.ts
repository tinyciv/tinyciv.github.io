/** Native-pixel shield designs from the 2026-10-27 warrior shield review:
 * 1B iron buckler, 2B painted oval, 3B painted legionary scutum. */
export const ARMOR_SHIELDS = [
  { name: 'Buckler', width: 5, height: 5 },
  { name: 'Oval shield', width: 6, height: 8 },
  { name: 'Legionary shield', width: 7, height: 10 },
] as const;

/** Equipment IV–VI improves combat while retaining the approved tier-III shield. */
export const armorVisualLevel = (level = 0): 0 | 1 | 2 | 3 =>
  Math.max(0, Math.min(ARMOR_SHIELDS.length, Math.floor(level))) as 0 | 1 | 2 | 3;

type Role = 'leader' | 'warrior';
type Point = readonly [number, number];
// Anatomical left-hand anchors: S, SE, E, NE, N, NW, W, SW.
// These follow the original eight perspectives, including their arm swings.
const SOLDIER_HANDS: readonly (readonly Point[])[] = [
  [[20.5,19.5],[20.5,18.5],[20,17.5],[20.5,18.5],[19.5,19.5],[19.5,18.5],[19.5,18.5],[21,16.5],[21,16.5]],
  [[20,18.5],[20,17.5],[20.5,19.5],[20,17.5],[19,18],[20.5,18.5],[20.5,18.5],[21,18],[21,18]],
  [[20,18.5],[20,17.5],[19,18.5],[20,17.5],[20,18.5],[20,17.5],[20,17.5],[21,18],[21,18]],
  [[11,18.5],[11,17.5],[10.5,19.5],[11,17.5],[12,18.5],[11,17.5],[11,17.5],[11,17.5],[11,17.5]],
  [[10.5,19.5],[10.5,18.5],[11.5,19.5],[10.5,18.5],[11,17.5],[11,18.5],[11,18.5],[11.5,18.5],[11.5,18.5]],
  [[11.5,19.5],[11.5,18.5],[11.5,18.5],[11.5,18.5],[12.5,19.5],[11.5,17.5],[11.5,17.5],[12,18.5],[12,18.5]],
  [[15.5,20.5],[15.5,19.5],[12.5,19.5],[15.5,19.5],[17.5,19.5],[11.5,18],[11.5,18],[18.5,18.5],[18.5,18.5]],
  [[19.5,19.5],[19.5,18.5],[19.5,18.5],[19.5,18.5],[18.5,19.5],[15.5,18.5],[15.5,18.5],[19,18.5],[19,18.5]],
];
// Leader uses walk 1–3 and attack 16–18, with distinct hand positions.
const LEADER_HANDS: readonly (readonly Point[])[] = [
  [[20.5,19.5],[20.5,18.5],[20,17.5],[19.5,19.5],[19.5,18.5],[21,16.5],[20.5,17.5]],
  [[20,18.5],[20,17.5],[20.5,19.5],[20,18.5],[20.5,18.5],[20,18],[20,17]],
  [[20,18.5],[20,17.5],[19,18.5],[20,19],[20,17.5],[20,18],[20,17.5]],
  [[11,18.5],[11,17.5],[10.5,19.5],[12,18.5],[11,17.5],[11,17.5],[11.5,16.5]],
  [[10.5,19.5],[10.5,18.5],[11.5,19.5],[11,17.5],[11,18.5],[11.5,18.5],[10.5,17.5]],
  [[11.5,19.5],[11.5,18.5],[11.5,18.5],[12.5,19.5],[11.5,17.5],[11.5,18.5],[11.5,17.5]],
  [[15.5,20.5],[15.5,19.5],[12.5,19.5],[17.5,19.5],[11.5,17.5],[18.5,18.5],[17.5,17.5]],
  [[19.5,19.5],[19.5,18.5],[19.5,18.5],[18.5,19.5],[15.5,18.5],[19,18.5],[20.5,17.5]],
];

function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement('canvas'); result.width = width; result.height = height;
  result.getContext('2d')!.imageSmoothingEnabled = false;
  return result;
}

export function armorShieldPose(role: Role, row: number, frame: number) {
  const index = role === 'leader' ? frame >= 16 ? frame - 12 : frame : frame;
  const anchor = (role === 'leader' ? LEADER_HANDS : SOLDIER_HANDS)[row][index];
  return { x: anchor[0], y: anchor[1], behind: row >= 1 && row <= 4,
    widthFactor: [1,.8,.32,.8,1,.8,.32,.8][row], back: row >= 3 && row <= 5 };
}

const shieldCache = new Map<string, HTMLCanvasElement>();
function shieldImage(level: number, row: number, color: string): HTMLCanvasElement {
  const key = `${level}:${row}:${color}`, cached = shieldCache.get(key);
  if (cached) return cached;
  const definition = ARMOR_SHIELDS[level - 1], pose = armorShieldPose('warrior', row, 0);
  const width = Math.max(2, Math.round(definition.width * pose.widthFactor)), height = definition.height;
  const result = canvas(width, height), c = result.getContext('2d')!;
  const rgb = [1,3,5].map(i => parseInt(color.slice(i,i+2),16));
  const shade = (factor: number) => `rgb(${rgb.map(value => Math.round(Math.min(255,value * factor))).join(',')})`;
  const painted = level > 1;
  const face = pose.back || !painted ? '#977044' : shade(.66);
  const light = pose.back || !painted ? '#b18a52' : shade(.95);
  const dark = pose.back || !painted ? '#6b4d30' : shade(.4);
  const inside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (level === 3) return y !== 0 && y !== height - 1 || x >= 1 && x < width - 1;
    return ((x + .5 - width / 2) / (width / 2)) ** 2 + ((y + .5 - height / 2) / (height / 2)) ** 2 <= 1.04;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!inside(x,y)) continue;
    const edge = !inside(x-1,y) || !inside(x+1,y) || !inside(x,y-1) || !inside(x,y+1);
    let ink = edge ? '#141b1b' : x >= width - 2 ? dark : y <= 1 ? light : face;
    if (width <= 3 && x >= 1 && y >= 1 && y < height - 1) ink = pose.back ? '#715438' : painted ? light : '#829291';
    if (!edge && level === 1) ink = x < width / 2 ? '#a6b2ac' : '#637470';
    if (!edge && level === 3 && !pose.back && x === Math.floor(width / 2)) ink = light;
    c.fillStyle = ink; c.fillRect(x,y,1,1);
  }
  if (width >= 4) {
    c.fillStyle = pose.back ? '#3c3024' : '#d1d5b9';
    c.fillRect(Math.floor(width / 2), Math.floor(height * .5), 1, 1);
    if (pose.back && height > 6) c.fillRect(Math.floor(width / 2), Math.floor(height * .5) - 1, 1, 3);
  }
  shieldCache.set(key,result); return result;
}

/** Bake once per faction/armor tier, keeping per-unit rendering one drawImage.
 * Source body and sword sweep occlude the far shield exactly as in the review. */
export function armoredCharacterSheet(source: HTMLCanvasElement, role: Role, level: number, color: string): HTMLCanvasElement {
  level = armorVisualLevel(level);
  if (!level) return source;
  const result = canvas(source.width,source.height), c = result.getContext('2d')!;
  c.drawImage(source,0,0);
  const body = canvas(32,32), bodyContext = body.getContext('2d')!;
  const effect = canvas(32,32), effectContext = effect.getContext('2d')!;
  const frames = role === 'leader' ? [0,1,2,3,16,17,18] : [0,1,2,3,4,5,6,7,8];
  for (let row = 0; row < 8; row++) for (const frame of frames) {
    bodyContext.clearRect(0,0,32,32); effectContext.clearRect(0,0,32,32);
    bodyContext.drawImage(source,frame*32,row*32,32,32,0,0,32,32);
    if (role === 'warrior' && frame === 7) {
      const pixels = bodyContext.getImageData(0,0,32,32), fx = effectContext.createImageData(32,32);
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i] === 227 && pixels.data[i+1] === 227 && pixels.data[i+2] === 227 && pixels.data[i+3]) {
          fx.data.set(pixels.data.subarray(i,i+4),i); pixels.data[i+3] = 0;
        }
      }
      bodyContext.putImageData(pixels,0,0); effectContext.putImageData(fx,0,0);
    }
    const pose = armorShieldPose(role,row,frame), shield = shieldImage(level,row,color);
    const left = Math.round(pose.x - shield.width / 2);
    const top = Math.round(pose.y - shield.height * (level === 3 ? .66 : level === 2 ? .6 : .5));
    c.save(); c.translate(frame*32,row*32); c.clearRect(0,0,32,32);
    if (pose.behind) c.drawImage(shield,left,top);
    c.drawImage(body,0,0);
    if (!pose.behind) c.drawImage(shield,left,top);
    c.drawImage(effect,0,0); c.restore();
  }
  return result;
}
