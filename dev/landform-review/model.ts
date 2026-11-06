import { WATER, type Point, type World } from '../../src/game/types';
import { ridgeGroundWalkable, ridgeLevel } from '../../src/game/ridges';
import { LANDFORM_KINDS, LANDFORM_NAMES, type LandscapeParameters, type LandformKind, type WorldGenerationStyle } from '../../src/world/options';
import type { LandformProvince } from '../../src/world/landforms';
import { forestSummary, type ForestSummary } from '../open-forest-review/model';
import { overviewPixels } from '../fractal-gallery/model';

export const REVIEW_SEEDS = ['ALDER-REACH', 'SILVER-WATERS'];
export const REVIEW_FAMILIES = LANDFORM_KINDS;
export const REVIEW_STYLE: WorldGenerationStyle = 'fractal';
export const PROVINCE_COLORS: Record<LandformKind, string> = {
  'river-basin': '#78bfc3', 'folded-range': '#d49b7b', 'dissected-plateau': '#c3ac73',
  'rift-lakes': '#9f9ed8', 'glacial-coast': '#b4d7d9', 'rolling-uplands': '#9ebc83',
};
export const FAMILY_NOTES: Record<LandformKind, string> = {
  'river-basin': 'Look for connected valleys, broad river lowlands and tributary structure.',
  'folded-range': 'Look for related ridge directions, branching ranges and low routes between them.',
  'dissected-plateau': 'Look for broad uplands interrupted by valleys, embayments and irregular edges.',
  'rift-lakes': 'Look for elongated basins, linked lakes and the relationship between water and enclosing relief.',
  'glacial-coast': 'Look for indented shores, aligned coastal valleys and uplands around sheltered water.',
  'rolling-uplands': 'Look for rounded hills, open low ground and a gentle, varied rhythm of relief.',
};
export type ViewMode = 'terrain' | 'height' | 'provinces';
export type FeatureKind = 'province' | 'relief' | 'river' | 'lake' | 'rift' | 'coast';
export interface FeatureFocus extends Point { name: string; cells: number; extent: number }
export interface ReliefShape extends FeatureFocus { aspect: number; angle: number; mountains: boolean; landform?: LandformKind }
export interface LandformSummary extends ForestSummary {
  flatShare: number; valleyShare: number; raisedShare: number; meanElongation: number;
  compactBodies: number; longBodies: number; orientation: number[]; reliefShapes: ReliefShape[];
  features: Record<FeatureKind, FeatureFocus[]>;
}
export interface ReviewRecord {
  id: string; seed: string; style: WorldGenerationStyle; family: LandformKind;
  width: number; height: number; parameters: LandscapeParameters; generationMs: number;
  summary: LandformSummary; capitals: Point[]; secondary: Point[]; provinces: LandformProvince[];
  previews: Record<ViewMode, string>; compressedWorld: string;
}

function pointOf(world: World, cell: number): Point { return { x: cell % world.width + .5, y: Math.floor(cell / world.width) + .5 }; }
function components(world: World, eligible: (cell: number) => boolean): number[][] {
  const seen = new Uint8Array(world.tiles.length), result: number[][] = [], { width, height } = world;
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || !eligible(i)) continue;
    const cells = [i]; seen[i] = 1;
    for (let head = 0; head < cells.length; head++) {
      const cell = cells[head], x = cell % width, y = Math.floor(cell / width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || !eligible(next)) continue;
        seen[next] = 1; cells.push(next);
      }
    }
    result.push(cells);
  }
  return result.sort((a, b) => b.length - a.length);
}
function focusOf(world: World, cells: number[], name: string): FeatureFocus {
  let x = 0, y = 0, minX = world.width, maxX = 0, minY = world.height, maxY = 0;
  for (const cell of cells) { const point = pointOf(world, cell); x += point.x; y += point.y; minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
  x /= cells.length; y /= cells.length;
  const nearest = cells.reduce((a, b) => { const pa = pointOf(world, a), pb = pointOf(world, b); return Math.hypot(pa.x - x, pa.y - y) < Math.hypot(pb.x - x, pb.y - y) ? a : b; });
  return { ...pointOf(world, nearest), name, cells: cells.length, extent: Math.max(maxX - minX, maxY - minY) + 1 };
}
export function landformSummary(world: World): LandformSummary {
  const base = forestSummary(world), { width, height, tiles } = world;
  const at = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height ? tiles[y * width + x] : undefined;
  let flats = 0, valleys = 0;
  const raised = tiles.filter(tile => tile.ridge && !WATER.has(tile.terrain)).length;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const tile = tiles[y * width + x]; if (WATER.has(tile.terrain)) continue;
    let flat = ridgeGroundWalkable(world, x, y);
    for (let dy = -1; dy <= 1 && flat; dy++) for (let dx = -1; dx <= 1; dx++) {
      const other = at(x + dx, y + dy)!;
      if (WATER.has(other.terrain) || ridgeLevel(other) !== ridgeLevel(tile) || !ridgeGroundWalkable(world, x + dx, y + dy)) { flat = false; break; }
    }
    flats += Number(flat);
    if (!tile.ridge) {
      const up = (dx: number, dy: number) => { for (let step = 1; step <= 6; step++) { const other = at(x + dx * step, y + dy * step); if (!other || WATER.has(other.terrain)) return false; if (other.ridge) return true; } return false; };
      valleys += Number(up(1, 0) && up(-1, 0) || up(0, 1) && up(0, -1));
    }
  }
  const reliefShapes = components(world, cell => !!tiles[cell].ridge && !WATER.has(tiles[cell].terrain)).filter(cells => cells.length >= 9).map((cells, index): ReliefShape => {
    let x = 0, y = 0; for (const cell of cells) { x += cell % width; y += Math.floor(cell / width); } x /= cells.length; y /= cells.length;
    let xx = 0, yy = 0, xy = 0;
    for (const cell of cells) { const dx = cell % width - x, dy = Math.floor(cell / width) - y; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
    const spread = Math.hypot(xx - yy, 2 * xy), aspect = Math.sqrt((xx + yy + spread + 1) / (xx + yy - spread + 1));
    const mountains = cells.some(cell => tiles[cell].relief === 'mountains');
    const counts = new Map<LandformKind, number>();
    for (const cell of cells) { const kind = tiles[cell].landform; if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1); }
    const landform = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { ...focusOf(world, cells, `${mountains ? 'Mountain' : 'Hill'} body ${index + 1}`), aspect, angle: .5 * Math.atan2(2 * xy, xx - yy), mountains, landform };
  });
  const orientation = [0, 0, 0, 0];
  for (const body of reliefShapes) if (body.aspect >= 1.5) orientation[((Math.round(body.angle / (Math.PI / 4)) % 4) + 4) % 4]++;
  const reliefFocus = [...reliefShapes].sort((a, b) => Number(b.landform === world.landformFamily) - Number(a.landform === world.landformFamily) || b.cells - a.cells).slice(0, 12);
  const features: Record<FeatureKind, FeatureFocus[]> = { province: [], relief: reliefFocus, river: [], lake: [], rift: [], coast: [] };
  for (const kind of ['river', 'lake'] as const) features[kind] = components(world, cell => tiles[cell].terrain === kind).slice(0, 8).map((cells, index) => focusOf(world, cells, `${kind === 'river' ? 'River reach' : 'Lake'} ${index + 1}`));
  for (const [index, province] of (world.landformProvinces ?? []).entries()) {
    const cells = tiles.flatMap((tile, cell) => tile.landform === province.kind && !WATER.has(tile.terrain) ? [cell] : []);
    if (!cells.length) continue;
    const nearest = cells.reduce((a, b) => { const pa = pointOf(world, a), pb = pointOf(world, b); return Math.hypot(pa.x - province.center.x, pa.y - province.center.y) < Math.hypot(pb.x - province.center.x, pb.y - province.center.y) ? a : b; });
    const focus = { ...pointOf(world, nearest), name: `${LANDFORM_NAMES[province.kind]} · province ${index + 1}`, cells: cells.length, extent: Math.max(province.radiusX, province.radiusY) * 2 };
    features.province.push(focus);
    if (province.kind === 'rift-lakes') features.rift.push(focus);
  }
  const mainland = new Set(components(world, cell => !WATER.has(tiles[cell].terrain))[0] ?? []);
  const coastalCells = tiles.flatMap((tile, cell) => {
    if (WATER.has(tile.terrain) || tile.landform !== 'glacial-coast') return [];
    if (!mainland.has(cell)) return [];
    const x = cell % width, y = Math.floor(cell / width);
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ['ocean', 'coast'].includes(at(x + dx, y + dy)?.terrain ?? '')) ? [cell] : [];
  });
  const coastRank = (cell: number) => {
    const { x, y } = pointOf(world, cell); let land = 0, relief = 0;
    for (let dy = -12; dy <= 12; dy += 3) for (let dx = -12; dx <= 12; dx += 3) {
      const tile = at(Math.floor(x) + dx, Math.floor(y) + dy);
      if (tile && !WATER.has(tile.terrain)) { land++; relief += Number(!!tile.ridge); }
    }
    // Nearby relief and land enclosing the water favor inlets. Keep the first
    // review location away from map edges and small offshore islands.
    return relief * 3 + land * .25 + Math.min(24, x, y, width - x, height - y);
  };
  const rankedCoasts = coastalCells.map(cell => ({ cell, score: coastRank(cell) })).sort((a, b) => b.score - a.score);
  for (const { cell } of rankedCoasts) { const point = pointOf(world, cell); if (features.coast.every(other => Math.hypot(other.x - point.x, other.y - point.y) >= 22)) features.coast.push({ ...point, name: `Glacial coastline ${features.coast.length + 1}`, cells: 1, extent: 22 }); if (features.coast.length >= 6) break; }
  return { ...base, flatShare: flats / Math.max(1, base.landTiles), valleyShare: valleys / Math.max(1, base.landTiles), raisedShare: raised / Math.max(1, base.landTiles),
    meanElongation: reliefShapes.reduce((sum, body) => sum + body.aspect, 0) / Math.max(1, reliefShapes.length),
    compactBodies: reliefShapes.filter(body => body.aspect < 1.8).length, longBodies: reliefShapes.filter(body => body.aspect >= 3).length, orientation, reliefShapes, features };
}
export function reviewPixels(world: World, mode: ViewMode): Uint8ClampedArray {
  if (mode === 'terrain') return overviewPixels(world);
  const pixels = new Uint8ClampedArray(world.tiles.length * 4);
  for (let cell = 0; cell < world.tiles.length; cell++) {
    const tile = world.tiles[cell], offset = cell * 4;
    let color: number[];
    if (WATER.has(tile.terrain)) color = tile.terrain === 'ocean' ? [26, 61, 80] : tile.terrain === 'coast' ? [40, 93, 115] : [96, 191, 194];
    else if (mode === 'provinces') { const value = parseInt((PROVINCE_COLORS[tile.landform!] ?? '#899080').slice(1), 16), shade = .72 + Math.min(1, tile.elevation) * .28; color = [value >> 16, value >> 8 & 255, value & 255].map(n => n * shade); }
    else { const value = 55 + Math.max(0, Math.min(1, tile.elevation)) * 195; color = [value * .98, value, value * .94]; }
    pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = 255;
  }
  return pixels;
}
