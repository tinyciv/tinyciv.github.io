import { createNoise2D } from 'simplex-noise';
import type { Point, World } from '../game/types';
import { DEFAULT_LANDSCAPE_PARAMETERS, type LandscapeParameters, type LandformFamily, type LandformKind } from './options';

export interface LandformProvince { kind: LandformKind; center: Point; radiusX: number; radiusY: number; angle: number }
/** Widths are full widths in world tiles; prominence and depth use 0..1 heights. */
export interface LandformRidge { points: Point[]; width: number; prominence: number; kind: 'hills' | 'mountains' }
export interface LandformValley { points: Point[]; width: number; depth: number }
export interface LandformBasin { center: Point; radiusX: number; radiusY: number; angle: number; lake: boolean }
export interface LandformPlan {
  family: LandformFamily; provinces: LandformProvince[]; ridges: LandformRidge[]; valleys: LandformValley[];
  basins: LandformBasin[]; elevation: Float32Array; resistance: Float32Array; uplift: Float32Array;
}
const KINDS: LandformKind[] = ['river-basin', 'folded-range', 'dissected-plateau', 'rift-lakes', 'glacial-coast', 'rolling-uplands'];
const RELATED: Record<LandformKind, [LandformKind, LandformKind]> = {
  'river-basin': ['rolling-uplands', 'folded-range'], 'folded-range': ['river-basin', 'glacial-coast'],
  'dissected-plateau': ['river-basin', 'rolling-uplands'], 'rift-lakes': ['folded-range', 'river-basin'],
  'glacial-coast': ['folded-range', 'rolling-uplands'], 'rolling-uplands': ['river-basin', 'dissected-plateau'],
};
const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
function randomStream(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => { state += 0x6d2b79f5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
function neighbors(cell: number, width: number, height: number, visit: (next: number) => void): void {
  const x = cell % width, y = Math.floor(cell / width);
  for (const [dx, dy] of CARDINAL) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height) visit(ny * width + nx);
  }
}
function distances(mask: Uint8Array, width: number, height: number, source: number): Int16Array {
  const result = new Int16Array(mask.length).fill(32767), queue: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i] === source) { result[i] = 0; queue.push(i); }
  for (let n = 0; n < queue.length; n++) neighbors(queue[n], width, height, next => {
    if (result[next] > result[queue[n]] + 1) { result[next] = result[queue[n]] + 1; queue.push(next); }
  });
  return result;
}
function largestLand(land: Uint8Array, width: number, height: number): number[] {
  const visited = new Uint8Array(land.length); let largest: number[] = [];
  for (let start = 0; start < land.length; start++) {
    if (!land[start] || visited[start]) continue;
    const cells = [start]; visited[start] = 1;
    for (let n = 0; n < cells.length; n++) neighbors(cells[n], width, height, next => {
      if (land[next] && !visited[next]) { visited[next] = 1; cells.push(next); }
    });
    if (cells.length > largest.length) largest = cells;
  }
  return largest;
}
function local(province: LandformProvince, x: number, y: number): Point {
  const dx = x - province.center.x, dy = y - province.center.y, c = Math.cos(province.angle), s = Math.sin(province.angle);
  return { x: (dx * c + dy * s) / province.radiusX, y: (-dx * s + dy * c) / province.radiusY };
}
function point(province: LandformProvince, u: number, v: number): Point {
  const c = Math.cos(province.angle), s = Math.sin(province.angle);
  return { x: province.center.x + u * province.radiusX * c - v * province.radiusY * s,
    y: province.center.y + u * province.radiusX * s + v * province.radiusY * c };
}
function secondaryWeight(province: LandformProvince, x: number, y: number): number {
  const p = local(province, x, y); return smooth((1.25 - Math.hypot(p.x, p.y)) / .65) * .96;
}
export function landformAt(plan: LandformPlan, x: number, y: number): LandformKind {
  let kind = plan.provinces[0].kind, strongest = .5;
  for (let n = 1; n < plan.provinces.length; n++) {
    const weight = secondaryWeight(plan.provinces[n], x, y);
    if (weight > strongest) { strongest = weight; kind = plan.provinces[n].kind; }
  }
  return kind;
}
function segmentDistance(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, t = clamp(((x - a.x) * dx + (y - a.y) * dy) / Math.max(.0001, dx * dx + dy * dy));
  return Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
}
function curve(province: LandformProvince, from: number, to: number, v: number, bend: number, phase: number, count = 12): Point[] {
  return Array.from({ length: count }, (_, n) => {
    const t = n / (count - 1), u = from + (to - from) * t;
    return point(province, u, v + Math.sin(t * Math.PI * 1.7 + phase) * bend + Math.sin(t * Math.PI * 3.1 + phase) * bend * .2);
  });
}
/** Change extent along the curve's chord separately from its lateral bends. */
function reshapeCurve(points: Point[], length: number, bend: number): void {
  if (length === 1 && bend === 1) return;
  const first = points[0], last = points[points.length - 1];
  const cx = (first.x + last.x) * .5, cy = (first.y + last.y) * .5;
  const distance = Math.hypot(last.x - first.x, last.y - first.y);
  if (distance < .001) return;
  const ux = (last.x - first.x) / distance, uy = (last.y - first.y) / distance;
  for (const p of points) {
    const dx = p.x - cx, dy = p.y - cy, along = (dx * ux + dy * uy) * length, across = (-dx * uy + dy * ux) * bend;
    p.x = cx + along * ux - across * uy; p.y = cy + along * uy + across * ux;
  }
}

/** Sparse valley/ridge structure precedes height sampling. This is a bounded,
 * geological design model, with dimensionless controls rather than dated strata. */
export function createLandformPlan(seed: string, width: number, height: number, land: Uint8Array, family: LandformFamily,
  parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): LandformPlan {
  if (width < 1 || height < 1 || land.length !== width * height) throw new RangeError('Landform mask dimensions do not match.');
  const random = randomStream(`${seed}:landforms:${family}`), noise = createNoise2D(random);
  const scale = Math.sqrt(width * height / (194 * 153)), inland = distances(land, width, height, 0);
  const defaults = DEFAULT_LANDSCAPE_PARAMETERS;
  const provinceScale = parameters.ruggednessScale / defaults.ruggednessScale;
  const main = largestLand(land, width, height);
  const candidates = main.length ? main : Array.from({ length: land.length }, (_, i) => i);
  const meanX = candidates.reduce((sum, i) => sum + i % width, 0) / candidates.length;
  const meanY = candidates.reduce((sum, i) => sum + Math.floor(i / width), 0) / candidates.length;
  let centerCell = candidates[0], score = -Infinity, xx = 0, xy = 0, yy = 0;
  for (const cell of candidates) {
    const x = cell % width, y = Math.floor(cell / width), dx = x - meanX, dy = y - meanY;
    xx += dx * dx; xy += dx * dy; yy += dy * dy;
    const quality = Math.min(inland[cell], 22 * scale) * .65 - Math.hypot(dx, dy);
    if (quality > score) { score = quality; centerCell = cell; }
  }
  const dominant = family === 'mixed' ? KINDS[Math.floor(random() * KINDS.length)] : family;
  const center = { x: centerCell % width, y: Math.floor(centerCell / width) };
  let angle = .5 * Math.atan2(2 * xy, xx - yy) + (random() - .5) * .4;
  if (dominant === 'glacial-coast') {
    let shore = centerCell, nearest = Infinity;
    for (const cell of candidates) if (inland[cell] === 1) {
      const d = Math.hypot(cell % width - center.x, Math.floor(cell / width) - center.y);
      if (d < nearest) { nearest = d; shore = cell; }
    }
    angle = Math.atan2(Math.floor(shore / width) - center.y, shore % width - center.x);
  }
  let rx = 0, ry = 0;
  for (const cell of candidates) {
    const dx = cell % width - center.x, dy = Math.floor(cell / width) - center.y;
    rx = Math.max(rx, Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle)));
    ry = Math.max(ry, Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle)));
  }
  const provinces: LandformProvince[] = [{ kind: dominant, center, radiusX: Math.max(12, rx * .91), radiusY: Math.max(10, ry * .91), angle }];
  if (family === 'mixed') for (let n = 0; n < 2; n++) {
    const target = point(provinces[0], n ? .52 : -.53, n ? .28 : -.27);
    let best = centerCell, distance = Infinity;
    for (const cell of candidates) {
      const d = Math.hypot(cell % width - target.x, Math.floor(cell / width) - target.y) - Math.min(inland[cell], 10) * .3;
      if (d < distance) { distance = d; best = cell; }
    }
    provinces.push({ kind: RELATED[dominant][n], center: { x: best % width, y: Math.floor(best / width) },
      radiusX: provinces[0].radiusX * .43 * Math.sqrt(provinceScale),
      radiusY: provinces[0].radiusY * .48 * Math.sqrt(provinceScale), angle: angle + (random() - .5) * .65 });
  }
  const plan: LandformPlan = { family, provinces, ridges: [], valleys: [], basins: [],
    elevation: new Float32Array(land.length), resistance: new Float32Array(land.length), uplift: new Float32Array(land.length) };
  const ridgeOwners: number[] = [], valleyOwners: number[] = [], basinOwners: number[] = [];
  provinces.forEach((p, owner) => {
    const unit = scale * (owner ? .7 : 1), phase = random() * Math.PI * 2;
    const ridge = (points: Point[], breadth: number, prominence: number, kind: 'hills' | 'mountains' = 'mountains') => {
      plan.ridges.push({ points, width: breadth * unit, prominence, kind }); ridgeOwners.push(owner);
    };
    const valley = (points: Point[], breadth: number, depth: number) => { plan.valleys.push({ points, width: breadth * unit, depth }); valleyOwners.push(owner); };
    const basin = (u: number, v: number, radiusX: number, radiusY: number, lake: boolean) => {
      let location = point(p, u, v), best = -1, distance = Infinity;
      // Basin centers belong to actual inland ground, including on curled coasts.
      for (const cell of candidates) if (inland[cell] >= Math.max(4, radiusY * unit + 2)) {
        const d = Math.hypot(cell % width - location.x, Math.floor(cell / width) - location.y);
        if (d < distance) { distance = d; best = cell; }
      }
      if (best >= 0) location = { x: best % width, y: Math.floor(best / width) };
      plan.basins.push({ center: location, radiusX: radiusX * unit, radiusY: radiusY * unit, angle: p.angle, lake }); basinOwners.push(owner);
    };
    if (p.kind === 'river-basin') {
      valley(curve(p, -.92, 1.16, 0, .12, phase), 14, .17);
      for (const side of [-1, 1]) {
        valley([point(p, -.70, side * .72), point(p, -.38, side * .34), point(p, .05, .03)], 6, .15);
        ridge(curve(p, -.83, .53, side * .54, .07, phase + side), 8, side < 0 ? .31 : .20, side < 0 ? 'mountains' : 'hills');
      }
      basin(.39, .02, 19, 11, false);
    } else if (p.kind === 'folded-range') {
      for (let band = -1; band <= 1; band++) for (const [from, to] of [[-.90, -.15], [.08, .9]])
        ridge(curve(p, from, to, band * .43, .08, phase + band * .6), 6.5 + (band === 0 ? 1.5 : 0), .34 + (band === 0 ? .08 : 0));
      for (const side of [-1, 1]) valley(curve(p, -.9, 1, side * .22, .07, phase), 8, .15);
      valley([point(p, -.03, -.95), point(p, -.03, -.25), point(p, .01, .3), point(p, -.03, .95)], 7, .23);
      basin(.58, .23, 9, 5, false);
    } else if (p.kind === 'dissected-plateau') {
      // The cap itself is broad and flat; these arcs describe its escarpment.
      for (let sector = 0; sector < 4; sector++) ridge(Array.from({ length: 9 }, (_, n) => {
        const a = sector * Math.PI / 2 + .12 + n / 8 * (Math.PI / 2 - .24);
        return point(p, Math.cos(a) * .74, Math.sin(a) * .70);
      }), 5.5, .08);
      valley(curve(p, -.98, 1.04, -.02, .09, phase), 7, .38);
      for (const side of [-1, 1]) valley([point(p, -.23, side * .72), point(p, -.11, side * .38), point(p, .2, 0)], 5.5, .30);
      basin(.77, 0, 12, 7, false);
    } else if (p.kind === 'rift-lakes') {
      valley(curve(p, -1, 1.12, 0, .035, phase), 18, .14);
      for (const side of [-1, 1]) for (const [from, to] of [[-.92, -.09], [.12, .92]])
        ridge(curve(p, from, to, side * .31, .025, phase), 7, .39);
      for (const u of [-.53, .04, .58]) basin(u, Math.sin(u * 3 + phase) * .025, owner ? 9 : 13, owner ? 3.5 : 5, true);
    } else if (p.kind === 'glacial-coast') {
      for (const v of [-.54, 0, .54]) {
        valley(curve(p, -.38, 1.32, v, .04, phase + v), 10, .34);
        basin(-.18, v, 9, 4.5, true);
      }
      for (const v of [-.78, -.27, .27, .78]) ridge(curve(p, -.64, 1.08, v, .07, phase + v), 8, .27);
    } else {
      for (let band = -1; band <= 1; band++) ridge(curve(p, -.78, .76, band * .52, .17, phase + band), 13, .12, 'hills');
      valley(curve(p, -.92, 1.08, .24, .13, phase), 13, .08);
      valley([point(p, -.63, -.74), point(p, -.34, -.17), point(p, .21, .2)], 10, .07);
      basin(.42, .2, 10, 7, true);
    }
  });
  // Existing controls adjust geological geometry before it becomes either
  // heights or native ledges. Ratios of one preserve the family design exactly.
  const mountainExtent = clamp(.35 * parameters.mountainLengthMin / defaults.mountainLengthMin
    + .65 * parameters.mountainLengthMax / defaults.mountainLengthMax, .55, 1.6);
  const elongation = Math.pow(parameters.mountainStringShare / defaults.mountainStringShare, .18);
  const bulk = Math.sqrt(parameters.mountainClumpShare / defaults.mountainClumpShare);
  for (const ridge of plan.ridges) if (ridge.kind === 'mountains') {
    reshapeCurve(ridge.points, mountainExtent * elongation, parameters.mountainBend / defaults.mountainBend);
    ridge.width *= bulk;
  }
  for (const valley of plan.valleys) reshapeCurve(valley.points, 1, parameters.riverMeander / defaults.riverMeander);
  const sample = (p: LandformProvince, x: number, y: number): { height: number; resistance: number; uplift: number } => {
    const { x: u, y: v } = local(p, x, y), radius = Math.hypot(u, v);
    const broad = noise(x / (32 * scale * provinceScale) + 13, y / (32 * scale * provinceScale) - 71);
    switch (p.kind) {
      case 'river-basin': return { height: .15 + .12 * clamp(Math.abs(v)) + .09 * clamp((.9 - u) / 2) + broad * .025, resistance: .30 + .26 * clamp(Math.abs(v)), uplift: .12 + .2 * clamp(-u) };
      case 'folded-range': return { height: .24 + .08 * Math.cos(v * Math.PI * 4.5 + u * .4) + broad * .025, resistance: .48 + .27 * Math.pow(Math.sin(v * 11 + u), 2), uplift: .50 * smooth((1.4 - radius) / .8) };
      case 'dissected-plateau': return { height: .16 + .46 * smooth((.93 - Math.hypot(u, v * 1.06)) / .22) + broad * .012, resistance: radius < .83 ? .88 : .4, uplift: .62 * smooth((1.05 - radius) / .4) };
      case 'rift-lakes': return { height: .25 + .17 * smooth(Math.abs(v) / .35) + broad * .024, resistance: .50 + .29 * smooth(Math.abs(v) / .3), uplift: .64 * smooth(Math.abs(v) / .3) * smooth((1.5 - radius) / .8) };
      case 'glacial-coast': return { height: .39 + .10 * clamp(1 - u) + broad * .025, resistance: .80, uplift: .55 * smooth((1.4 - radius) / .8) };
      case 'rolling-uplands': return { height: .17 + .08 * (broad + 1) + .035 * Math.cos(u * 4 + v * 2), resistance: .42 + broad * .1, uplift: .12 };
    }
  };
  for (let cell = 0; cell < land.length; cell++) {
    const x = cell % width, y = Math.floor(cell / width); let value = sample(provinces[0], x, y);
    for (let n = 1; n < provinces.length; n++) {
      const w = secondaryWeight(provinces[n], x, y), other = sample(provinces[n], x, y);
      value = { height: value.height * (1 - w) + other.height * w,
        resistance: value.resistance * (1 - w) + other.resistance * w, uplift: value.uplift * (1 - w) + other.uplift * w };
    }
    plan.elevation[cell] = value.height; plan.resistance[cell] = value.resistance; plan.uplift[cell] = value.uplift;
  }
  const secondaryProvinces = provinces.slice(1);
  const featureWeight = (owner: number, x: number, y: number) => owner ? secondaryWeight(provinces[owner], x, y)
    : secondaryProvinces.reduce((weight, p) => weight * (1 - secondaryWeight(p, x, y)), 1);
  const stroke = (points: Point[], breadth: number, strength: number, owner: number, field: Float32Array) => {
    const radius = breadth * .5, reach = radius * 2.4;
    for (let n = 1; n < points.length; n++) {
      const a = points[n - 1], b = points[n];
      for (let y = Math.max(0, Math.floor(Math.min(a.y, b.y) - reach)); y <= Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + reach)); y++)
        for (let x = Math.max(0, Math.floor(Math.min(a.x, b.x) - reach)); x <= Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + reach)); x++) {
          const d = segmentDistance(x, y, a, b), influence = Math.exp(-.5 * (d / radius) ** 2) * strength * featureWeight(owner, x, y);
          field[y * width + x] = Math.max(field[y * width + x], influence);
        }
    }
  };
  const raised = new Float32Array(land.length), incised = new Float32Array(land.length);
  plan.ridges.forEach((r, n) => stroke(r.points, r.width, r.prominence, ridgeOwners[n], raised));
  plan.valleys.forEach((v, n) => stroke(v.points, v.width, v.depth, valleyOwners[n], incised));
  for (let cell = 0; cell < land.length; cell++) plan.elevation[cell] = clamp(plan.elevation[cell] + raised[cell] - incised[cell], .035, .92);
  plan.basins.forEach((basin, n) => {
    const reach = Math.max(basin.radiusX, basin.radiusY) * 1.35, p = { ...basin, kind: provinces[basinOwners[n]].kind };
    for (let y = Math.max(0, Math.floor(basin.center.y - reach)); y <= Math.min(height - 1, Math.ceil(basin.center.y + reach)); y++)
      for (let x = Math.max(0, Math.floor(basin.center.x - reach)); x <= Math.min(width - 1, Math.ceil(basin.center.x + reach)); x++) {
        const q = local(p, x, y), r = Math.hypot(q.x, q.y), weight = smooth((1.25 - r) / .35) * featureWeight(basinOwners[n], x, y);
        const cell = y * width + x, floor = basin.lake ? .075 + .055 * Math.min(1, r * r) : .115 + .025 * q.x;
        plan.elevation[cell] = plan.elevation[cell] * (1 - weight) + Math.min(plan.elevation[cell], floor) * weight;
      }
  });
  // Three erosion/deposition steps accentuate connected slopes without erasing
  // the sparse authored skeleton. The rate is a visual proxy, not physical time.
  for (let cell = 0; cell < land.length; cell++) if (!land[cell]) plan.elevation[cell] = 0;
  const cells = candidates.slice();
  for (let iteration = 0; iteration < 3; iteration++) {
    const flow = new Float32Array(land.length).fill(1), receiver = new Int32Array(land.length).fill(-1);
    cells.sort((a, b) => plan.elevation[b] - plan.elevation[a] || a - b);
    for (const cell of cells) {
      let lowest = plan.elevation[cell];
      neighbors(cell, width, height, next => { if (plan.elevation[next] < lowest) { lowest = plan.elevation[next]; receiver[cell] = next; } });
      if (receiver[cell] >= 0) flow[receiver[cell]] += flow[cell];
    }
    const delta = new Float32Array(land.length);
    for (const cell of cells) {
      const next = receiver[cell]; if (next < 0) continue;
      const slope = plan.elevation[cell] - plan.elevation[next];
      const erosion = Math.min(.012, .028 * Math.sqrt(flow[cell]) * slope * (1 - plan.resistance[cell] * .75));
      delta[cell] -= erosion;
      if (land[next]) delta[next] += erosion * (slope < .045 ? .65 : .12);
    }
    for (const cell of cells) if (land[cell])
      plan.elevation[cell] = clamp(plan.elevation[cell] + delta[cell] + plan.uplift[cell] * .0008, .025, .94);
  }
  for (let cell = 0; cell < land.length; cell++) {
    if (!land[cell]) { plan.elevation[cell] = 0; plan.uplift[cell] = 0; continue; }
    const kind = landformAt(plan, cell % width, Math.floor(cell / width));
    if (kind === 'river-basin' || kind === 'rolling-uplands') plan.elevation[cell] *= .5 + .5 * smooth(inland[cell] / (10 * scale));
  }
  return plan;
}

/** Fjords cut into an existing mainland; depositional mouths extend its shallow
 * shore. Each cut must preserve mainland connectivity, so no new islet swarm or
 * disconnected starting realm is introduced by a coastline treatment. */
export function shapeLandformCoasts(land: Uint8Array, width: number, height: number, plan: LandformPlan): void {
  const originalMain = largestLand(land, width, height), main = new Set(originalMain), originalCount = originalMain.length;
  if (originalCount < 200) return;
  const scale = Math.sqrt(width * height / (194 * 153)), inland = distances(land, width, height, 0);
  let removed = 0;
  for (const valley of plan.valleys) {
    const middle = valley.points[Math.floor(valley.points.length / 2)];
    if (landformAt(plan, middle.x, middle.y) !== 'glacial-coast') continue;
    const proposed = new Set<number>(), radius = Math.max(1.5, valley.width * .28);
    for (let n = 1; n < valley.points.length; n++) {
      const a = valley.points[n - 1], b = valley.points[n];
      for (let y = Math.max(2, Math.floor(Math.min(a.y, b.y) - radius)); y <= Math.min(height - 3, Math.ceil(Math.max(a.y, b.y) + radius)); y++)
        for (let x = Math.max(2, Math.floor(Math.min(a.x, b.x) - radius)); x <= Math.min(width - 3, Math.ceil(Math.max(a.x, b.x) + radius)); x++) {
          const cell = y * width + x;
          if (main.has(cell) && inland[cell] <= 17 * scale && segmentDistance(x, y, a, b) <= radius) proposed.add(cell);
        }
    }
    // Only coastline-connected excavation belongs to the fjord; inland sections
    // remain troughs and lakes rather than unexplained patches of saltwater.
    const wet = new Set<number>(), queue: number[] = [];
    for (const cell of proposed) neighbors(cell, width, height, next => { if (!land[next] && !wet.has(cell)) { wet.add(cell); queue.push(cell); } });
    for (let n = 0; n < queue.length; n++) neighbors(queue[n], width, height, next => {
      if (proposed.has(next) && !wet.has(next)) { wet.add(next); queue.push(next); }
    });
    if (!wet.size || removed + wet.size > originalCount * .065) continue;
    for (const cell of wet) land[cell] = 0;
    const after = largestLand(land, width, height);
    if (after.length !== originalCount - removed - wet.size) { for (const cell of wet) land[cell] = 1; continue; }
    removed += wet.size;
    for (const cell of wet) { main.delete(cell); plan.elevation[cell] = 0; }
  }
  // A broad low fan at a basin outlet adds connected coast, not offshore dots.
  const offshore = distances(land, width, height, 1);
  let added = 0;
  for (const valley of plan.valleys) {
    if (valley.width < 10 * scale) continue;
    const middle = valley.points[Math.floor(valley.points.length / 2)];
    if (landformAt(plan, middle.x, middle.y) !== 'river-basin') continue;
    let mouth: Point | undefined;
    for (let n = 1; n < valley.points.length; n++) {
      const a = valley.points[n - 1], b = valley.points[n], steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
      for (let step = 0; step <= steps; step++) {
        const t = step / Math.max(1, steps), x = Math.round(a.x + (b.x - a.x) * t), y = Math.round(a.y + (b.y - a.y) * t);
        if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) continue;
        if (main.has(y * width + x) && inland[y * width + x] <= 2) mouth = { x, y };
      }
    }
    if (!mouth) continue;
    const radius = 10 * scale;
    for (let depth = 1; depth <= Math.max(2, Math.round(4 * scale)); depth++)
      for (let y = Math.max(3, Math.floor(mouth.y - radius)); y <= Math.min(height - 4, Math.ceil(mouth.y + radius)); y++)
        for (let x = Math.max(3, Math.floor(mouth.x - radius)); x <= Math.min(width - 4, Math.ceil(mouth.x + radius)); x++) {
          const cell = y * width + x;
          if (land[cell] || offshore[cell] !== depth || added >= originalCount * .025
            || Math.hypot(x - mouth.x, y - mouth.y) > radius * (1 - depth * .10)) continue;
          let connected = false; neighbors(cell, width, height, next => { if (main.has(next)) connected = true; });
          if (!connected) continue;
          land[cell] = 1; main.add(cell); added++; plan.elevation[cell] = Math.max(.025, .035 + (5 - depth) * .008);
        }
  }
}

/** Rasterize the geological plan into existing tile metadata before waterways
 * and native ledges are placed. All display assets remain unchanged. */
export function applyLandformHeights(world: World, plan: LandformPlan): void {
  if (world.tiles.length !== plan.elevation.length) throw new RangeError('Landform plan dimensions do not match world.');
  const { width, height, tiles } = world;
  for (let cell = 0; cell < tiles.length; cell++) {
    const tile = tiles[cell];
    if (tile.terrain === 'ocean' || tile.terrain === 'coast') { tile.elevation = 0; continue; }
    const x = cell % width, y = Math.floor(cell / width);
    tile.elevation = Math.max(.025, plan.elevation[cell]); tile.landform = landformAt(plan, x, y);
    tile.rockResistance = clamp(plan.resistance[cell]);
    let surrounding = 0, count = 0;
    neighbors(cell, width, height, next => { surrounding += plan.elevation[next]; count++; });
    const concavity = Math.max(0, surrounding / Math.max(1, count) - tile.elevation);
    tile.sediment = clamp((1 - tile.rockResistance) * (1 - tile.elevation) * .45 + concavity * 2);
  }
}
