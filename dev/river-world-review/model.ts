import { type Point, type Tile, type World } from '../../src/game/types';
import { ridgeIsLedge } from '../../src/game/ridges';
import { type LandscapeParameters, type LandformKind, type WorldGenerationStyle } from '../../src/world/options';
import type { LandformProvince } from '../../src/world/landforms';
import { landformSummary, reviewPixels as landformPixels, type LandformSummary, type FeatureFocus } from '../landform-review/model';

export const REVIEW_SEEDS = ['ALDER-CANYONS', 'SILVER-CANYONS'];
export const REVIEW_FAMILIES: LandformKind[] = ['river-basin', 'folded-range', 'dissected-plateau'];
export const REVIEW_STYLE: WorldGenerationStyle = 'fractal';
/** Broader existing uplands make the river cuts visible in this review set. */
export const REVIEW_PARAMETERS: Partial<LandscapeParameters> = { reliefCoverage: .14, hillSize: 1.4, mountainWidth: 6, mountainShare: .5 };
export const FAMILY_NOTES: Partial<Record<LandformKind, string>> = {
  'river-basin': 'Follow small winding rivers into larger tributaries and broad lowland channels.',
  'folded-range': 'Look for water cutting across established ranges, with steep native ledges along the canyon.',
  'dissected-plateau': 'Inspect winding channels inset below broad uplands, and the ledged edges left by the cut.',
};
export type ViewMode = 'terrain' | 'height' | 'network';
export type FeatureKind = 'tributary' | 'main' | 'canyon' | 'relief' | 'river' | 'lake';
export interface RiverSummary extends Omit<LandformSummary, 'features'> {
  features: Record<FeatureKind, FeatureFocus[]>;
  tributaryTiles: number; mainTiles: number;
  confluences: number; fordTiles: number; canyonTiles: number; canyonLedges: number;
}
export interface ReviewRecord {
  id: string; seed: string; style: WorldGenerationStyle; family: LandformKind;
  width: number; height: number; parameters: LandscapeParameters; generationMs: number;
  summary: RiverSummary; capitals: Point[]; secondary: Point[]; provinces: LandformProvince[];
  previews: Record<ViewMode, string>; compressedWorld: string;
}
// These accessors are kept together so diagnostics share the generated channel
// classification, rather than guessing river size from the rendered footprint.
export function channelClass(tile: Tile): number {
  return tile.channel === 'tributary' ? 2 : tile.channel === 'main' ? 3 : 0;
}
export function isCanyon(tile: Tile): boolean {
  return !!tile.canyon;
}
function xy(world: World, cell: number): Point { return { x: cell % world.width + .5, y: Math.floor(cell / world.width) + .5 }; }
function focus(world: World, cell: number, name: string, cells = 1): FeatureFocus { return { ...xy(world, cell), name, cells, extent: 20 }; }
function spread(world: World, candidates: number[], name: string, radius = 14): FeatureFocus[] {
  const selected: number[] = [];
  for (const cell of candidates) {
    const p = xy(world, cell);
    if (selected.some(other => { const q = xy(world, other); return Math.hypot(q.x - p.x, q.y - p.y) < radius; })) continue;
    selected.push(cell); if (selected.length >= 12) break;
  }
  return selected.map((cell, n) => focus(world, cell, `${name} ${n + 1}`));
}
export function riverWorldSummary(world: World): RiverSummary {
  const base = landformSummary(world), { width, height, tiles } = world;
  const classes = tiles.map(channelClass), counts = [0, 0, 0, 0], incoming = new Uint16Array(tiles.length);
  const dominantParent = new Int32Array(tiles.length).fill(-1);
  for (let cell = 0; cell < tiles.length; cell++) {
    counts[classes[cell]]++;
    const next = tiles[cell].channelNext;
    if (classes[cell] && next !== undefined && next >= 0 && next < tiles.length && classes[next]) {
      incoming[next]++;
      if (dominantParent[next] < 0 || (tiles[cell].flow ?? 0) > (tiles[dominantParent[next]].flow ?? 0)) dominantParent[next] = cell;
    }
  }
  const inland = (cell: number) => { const p = xy(world, cell); return p.x > 10 && p.y > 10 && p.x < width - 10 && p.y < height - 10; };
  const rank = (cell: number) => {
    const p = xy(world, cell); let channels = 0, ledges = 0;
    for (let dy = -8; dy <= 8; dy += 2) for (let dx = -8; dx <= 8; dx += 2) {
      const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + dy, at = y * width + x;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      channels += Number(!!classes[at]); ledges += Number(ridgeIsLedge(world, x, y));
    }
    return channels + ledges * .2;
  };
  const byClass = (kind: number) => tiles.flatMap((_, i) => classes[i] === kind && inland(i) ? [i] : []).sort((a, b) => rank(b) - rank(a));
  const canyon = tiles.flatMap((tile, i) => {
    if (tile.canyon !== 'floor' || !classes[i] || incoming[i] > 1 || !inland(i)) return [];
    if (tile.terrain !== 'river') return [];
    const p = xy(world, i); let up = i, down = i, upstreamSteps = 0, downstreamSteps = 0;
    for (let step = 0; step < 4; step++) {
      if (dominantParent[up] >= 0) { up = dominantParent[up]; upstreamSteps++; }
      const next = tiles[down].channelNext;
      if (next !== undefined && next >= 0 && next < tiles.length && classes[next]) { down = next; downstreamSteps++; }
    }
    if (upstreamSteps < 3 || downstreamSteps < 3) return [];
    const a = xy(world, up), b = xy(world, down), length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) return [];
    const tx = (b.x - a.x) / length, ty = (b.y - a.y) / length, nx = -ty, ny = tx;
    let left = 0, right = 0;
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + dy;
      if (x < 0 || y < 0 || x >= width || y >= height || Math.hypot(dx, dy) > 8) continue;
      const across = dx * nx + dy * ny, along = dx * tx + dy * ty;
      if (Math.abs(along) > 5 || Math.abs(across) < 1.5) continue;
      const wall = tiles[y * width + x];
      if (wall.canyon === 'wall' && ridgeIsLedge(world, x, y)) {
        const weight = (wall.ridgeTier ?? 1) / Math.max(1, Math.hypot(dx, dy));
        if (across < 0) left += weight; else right += weight;
      }
    }
    if (Math.min(left, right) < .8) return [];
    return [{ cell: i, score: Math.min(left, right) * 4 + Math.sqrt(left * right) * 2 + Math.max(left, right) * .15 }];
  }).sort((a, b) => b.score - a.score).map(candidate => candidate.cell);
  const features: Record<FeatureKind, FeatureFocus[]> = {
    tributary: spread(world, byClass(2), 'Small river'),
    main: spread(world, byClass(3), 'Large river'), canyon: spread(world, canyon, 'River-cut canyon'),
    relief: base.features.relief, river: base.features.river, lake: base.features.lake,
  };
  return { ...base, features, tributaryTiles: counts[2], mainTiles: counts[3],
    confluences: incoming.reduce((sum, n) => sum + Number(n > 1), 0),
    fordTiles: tiles.filter(tile => tile.overlay === 'ford').length,
    canyonTiles: tiles.filter(tile => tile.canyon === 'floor' && !!tile.channel).length,
    canyonLedges: tiles.reduce((sum, tile, i) => sum + Number(isCanyon(tile) && ridgeIsLedge(world, i % width, Math.floor(i / width))), 0),
  };
}
export function reviewPixels(world: World, mode: ViewMode): Uint8ClampedArray {
  const pixels = landformPixels(world, mode === 'height' ? 'height' : 'terrain');
  for (let cell = 0; cell < world.tiles.length; cell++) {
    const tile = world.tiles[cell], kind = channelClass(tile), offset = cell * 4;
    if (mode === 'network') {
      for (let n = 0; n < 3; n++) pixels[offset + n] = Math.round(pixels[offset + n] * .35);
      const color = kind === 2 ? [46, 200, 210] : kind === 3 ? [92, 143, 233]
        : isCanyon(tile) && tile.ridge ? [230, 185, 112] : undefined;
      if (color) pixels.set(color, offset);
    }
  }
  return pixels;
}
