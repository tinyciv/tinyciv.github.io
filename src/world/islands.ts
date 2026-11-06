import { DEFAULT_WORLD_STYLE, DEFAULT_LANDSCAPE_PARAMETERS, type LandscapeParameters, type WorldGenerationStyle } from './options';

/** Add small coastal landforms before climate and scenery are generated. */
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

export type LandformStyle = WorldGenerationStyle;
interface LandBody { x: number; y: number; rx: number; ry: number; angle: number }
export interface LandformProfile {
  style: LandformStyle;
  bodies: LandBody[];
  mirrorX: boolean;
  mirrorY: boolean;
  transpose: boolean;
  /** Development maps reserve their scarce land for the twenty-one towns. */
  compact: boolean;
  coastRoughness?: number;
  /** Sea-filled indentations are regional bays, not independent inland holes. */
  bays?: LandBody[];
  /** A meandering sea passage keeps the two continental cores separate. */
  strait?: { center: number; width: number; bend: number; phase: number; tilt: number };
}

/** Seeded, broad-scale geography; the quilt still supplies the local coastline.
 * A generous primary landmass keeps all starting civilizations mutually reachable.
 * Separate lobes reserve ocean channels and make the remaining islands vary in
 * size and placement rather than only sprinkling pebbles around one oval. */
export function createLandformProfile(random: () => number, width: number, height: number,
  style: WorldGenerationStyle = DEFAULT_WORLD_STYLE,
  parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): LandformProfile {
  const compact = Math.min(width, height) < 128;
  const bodies: LandBody[] = [], bays: LandBody[] = [];
  let strait: LandformProfile['strait'];
  const add = (x: number, y: number, rx: number, ry: number, angle = 0) => bodies.push({ x, y, rx, ry, angle });
  if (compact) add(.5, .5, .48, .47);
  else if (style === 'pangaea') {
    const cx = .47 + random() * .06, cy = .47 + random() * .06;
    add(cx, cy, .36 + random() * .065, .36 + random() * .065, (random() - .5) * .8);
    // Overlapping regional lobes form asymmetric peninsulas and broad necks.
    // Their centers remain inside the core so even deeply indented worlds
    // retain a generous connected mainland for the starting realms.
    const arms = 2 + Math.floor(random() * 4), phase = random() * Math.PI * 2;
    for (let n = 0; n < arms; n++) {
      const angle = phase + n * Math.PI * 2 / arms + (random() - .5) * .5;
      add(cx + Math.cos(angle) * .25, cy + Math.sin(angle) * .25,
        .13 + random() * .07, .10 + random() * .08, angle);
    }
    const angle = phase + Math.PI / arms;
    bays.push({ x: cx + Math.cos(angle) * .43, y: cy + Math.sin(angle) * .43,
      rx: .13 + random() * .05, ry: .065 + random() * .04, angle });
  } else if (style === 'continents') {
    const center = .65 + random() * .035;
    strait = { center, width: .012 + random() * .009, bend: .012 + random() * .025,
      phase: random() * Math.PI * 2, tilt: (random() - .5) * .09 };
    const cy = .45 + random() * .10;
    add(.31 + random() * .025, cy, .285 + random() * .035, .37 + random() * .06, (random() - .5) * .3);
    add(.81 + random() * .02, .45 + random() * .10, .16 + random() * .025, .31 + random() * .055, (random() - .5) * .4);
    // Vary which end of each continent reaches into the sea. The strait
    // follows a broad curve instead of the former fixed vertical cut.
    add(.48 + random() * .045, .20 + random() * .59, .12 + random() * .025, .08 + random() * .06, random() * Math.PI);
    if (random() < .65) add(.78 + random() * .06, .88, .09, .055, (random() - .5) * .8);
    bays.push({ x: .02, y: .28 + random() * .44, rx: .11 + random() * .05, ry: .065 + random() * .06, angle: (random() - .5) * .5 });
  } else {
    const cx = .32 + random() * .055, cy = .46 + random() * .08;
    add(cx, cy, .25 + random() * .045, .35 + random() * .045, (random() - .5) * .3);
    const arms = 3 + Math.floor(random() * 3);
    for (let n = 0; n < arms; n++) {
      const y = .18 + n * .64 / (arms - 1) + (random() - .5) * .07;
      add(cx + .11 + random() * .07, y, .17 + random() * .065, .08 + random() * .065, (y - cy) * 1.5 + (random() - .5) * .6);
    }
    bays.push({ x: .59 + random() * .055, y: .35 + random() * .30,
      rx: .12 + random() * .045, ry: .055 + random() * .035, angle: (random() - .5) * .6 });
    const count = 5 + Math.floor(random() * 4);
    const chainBend = random() * Math.PI * 2;
    for (let n = 0; n < count; n++) {
      const y = .13 + n * .74 / (count - 1);
      add(.82 + Math.sin(y * 5 + chainBend) * .07, y + (random() - .5) * .04,
        .04 + random() * .055, .035 + random() * .05, random() * 2);
    }
  }
  if (!compact) for (const body of bodies) { body.rx *= parameters.landScale; body.ry *= parameters.landScale; }
  return { style, bodies, bays, strait, compact, coastRoughness: parameters.coastRoughness,
    mirrorX: random() < .5, mirrorY: random() < .5, transpose: !compact && random() < .5 };
}

/** Signed distance-like density for quilting; smooth warping avoids geometric
 * ellipses while the strong ocean valleys keep separate landforms separated. */
export function landformDensity(profile: LandformProfile, x: number, y: number, width: number, height: number,
  noise: (x: number, y: number) => number): number {
  let u = x / width, v = y / height;
  if (profile.mirrorX) u = 1 - u;
  if (profile.mirrorY) v = 1 - v;
  if (profile.transpose) [u, v] = [v, u];
  if (!profile.compact) {
    const warp = (profile.style === 'fractal' ? .045 : .012) * (profile.coastRoughness ?? 1);
    u += noise(x * .018 + 41, y * .018 - 23) * warp;
    v += noise(x * .018 - 53, y * .018 + 17) * warp;
  }
  let density = -Infinity;
  for (const body of profile.bodies) {
    const dx = u - body.x, dy = v - body.y, c = Math.cos(body.angle), s = Math.sin(body.angle);
    const radius = Math.hypot((dx * c + dy * s) / body.rx, (dy * c - dx * s) / body.ry);
    const detail = profile.style === 'fractal' && !profile.compact
      ? noise(x * .028, y * .028) * .28 + noise(x * .063 + 19, y * .063) * .12 + noise(x * .14, y * .14 - 31) * .05
      : noise(x * .021, y * .021) * .12;
    density = Math.max(density, (1.03 - radius + detail * (profile.coastRoughness ?? 1)) * 3.5 + .25);
  }
  for (const bay of profile.bays ?? []) {
    const dx = u - bay.x, dy = v - bay.y, c = Math.cos(bay.angle), s = Math.sin(bay.angle);
    const radius = Math.hypot((dx * c + dy * s) / bay.rx, (dy * c - dx * s) / bay.ry);
    density = Math.min(density, (radius - .95) * 4);
  }
  if (profile.strait) {
    const passage = profile.strait;
    const center = passage.center + Math.sin(v * Math.PI * 2 + passage.phase) * passage.bend + (v - .5) * passage.tilt;
    density = Math.min(density, (Math.abs(u - center) - passage.width) * 28 - .25);
  }
  return density;
}

export interface OffshoreIslandOptions { density?: number; reach?: number; largeChance?: number; size?: number }

function mainlandMask(land: Uint8Array, width: number, height: number): Uint8Array {
  const seen = new Uint8Array(land.length);
  let largest: number[] = [];
  for (let start = 0; start < land.length; start++) {
    if (!land[start] || seen[start]) continue;
    const cells = [start]; seen[start] = 1;
    for (let head = 0; head < cells.length; head++) {
      const i = cells[head], x = i % width, y = Math.floor(i / width);
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || !land[next]) continue;
        seen[next] = 1; cells.push(next);
      }
    }
    if (cells.length > largest.length) largest = cells;
  }
  const mask = new Uint8Array(land.length);
  for (const i of largest) mask[i] = 1;
  return mask;
}

/** Euclidean chamfer distance, independent of water/land terrain labels. */
function offshoreDistance(land: Uint8Array, width: number, height: number): Float32Array {
  const result = Float32Array.from(land, value => value ? 0 : Infinity), diagonal = Math.SQRT2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x) result[i] = Math.min(result[i], result[i - 1] + 1);
    if (y) {
      result[i] = Math.min(result[i], result[i - width] + 1);
      if (x) result[i] = Math.min(result[i], result[i - width - 1] + diagonal);
      if (x + 1 < width) result[i] = Math.min(result[i], result[i - width + 1] + diagonal);
    }
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x + 1 < width) result[i] = Math.min(result[i], result[i + 1] + 1);
    if (y + 1 < height) {
      result[i] = Math.min(result[i], result[i + width] + 1);
      if (x) result[i] = Math.min(result[i], result[i + width - 1] + diagonal);
      if (x + 1 < width) result[i] = Math.min(result[i], result[i + width + 1] + diagonal);
    }
  }
  return result;
}

/** Return the added islands for generator diagnostics. Every island is separate
 * even diagonally. The default coastal setting leaves one to ten water tiles
 * to the mainland; broad archipelago profiles may reach farther out to sea.
 * Land is added before normal biome, woodland, beach, and ridge placement; no
 * special island biome suppresses the world's usual landscape features. */
export function addOffshoreIslands(land: Uint8Array, width: number, height: number,
  random: () => number, noise: (x: number, y: number) => number, options: OffshoreIslandOptions = {}): number[][] {
  const mainland = mainlandMask(land, width, height), distance = offshoreDistance(mainland, width, height);
  const reach = options.reach ?? 15, size = options.size ?? 1;
  const blocked = new Uint8Array(land.length), candidates: number[] = [];
  const exclude = (i: number): void => {
    blocked[i] = 1;
    const x = i % width, y = Math.floor(i / width);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) blocked[ny * width + nx] = 1;
    }
  };
  for (let i = 0; i < land.length; i++) if (land[i]) exclude(i);
  for (let y = 4; y < height - 4; y++) for (let x = 4; x < width - 4; x++) {
    const i = y * width + x;
    if (!blocked[i] && distance[i] >= 4 && distance[i] <= reach) candidates.push(i);
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const target = Math.max(4, Math.round(width * height / 1700 * (options.density ?? 1))), islands: number[][] = [];
  for (const center of candidates) {
    if (islands.length >= target) break;
    if (blocked[center]) continue;
    const cx = center % width, cy = Math.floor(center / width);
    // Most are a few cells across; occasional larger islets can carry a ridge.
    const large = random() < (options.largeChance ?? .2), rx = (large ? 5 + random() * 3 : 1.5 + random() * 2.5) * size;
    const ry = (large ? 4 + random() * 3 : 1.5 + random() * 2.5) * size;
    const cells: number[] = [];
    let fits = true, nearest = Infinity;
    for (let y = Math.floor(cy - ry * 1.2); y <= Math.ceil(cy + ry * 1.2) && fits; y++)
      for (let x = Math.floor(cx - rx * 1.2); x <= Math.ceil(cx + rx * 1.2); x++) {
        if (Math.hypot((x - cx) / rx, (y - cy) / ry) > 1 + noise(x * .31 + 37, y * .31 - 61) * .17) continue;
        if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) { fits = false; break; }
        const i = y * width + x;
        if (blocked[i]) { fits = false; break; }
        cells.push(i); nearest = Math.min(nearest, distance[i]);
      }
    if (!fits || cells.length < 6 || nearest > reach - 4) continue;
    for (const i of cells) { land[i] = 1; exclude(i); }
    islands.push(cells);
  }
  return islands;
}
