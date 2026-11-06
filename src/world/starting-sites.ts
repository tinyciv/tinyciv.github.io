import type { Point } from '../game/types';
import { DEFAULT_LANDSCAPE_PARAMETERS, type LandscapeParameters } from './options';

export interface StartingSite extends Point { quality: number; scenic: number; tie: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Farthest-point seeding followed by constrained Lloyd relaxation spreads
 * realms across usable land. Every move snaps to a genuinely viable site;
 * neither water nor an unsuitable geometric centroid can become a capital. */
export function spreadFactionStarts(candidates: StartingSite[], count: number, minimumGap: number,
  parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): StartingSite[] {
  if (!candidates.length) return [];
  const chosen = [candidates[0]];
  for (let n = 1; n < count; n++) {
    let best: StartingSite | undefined, bestScore = -Infinity;
    for (const candidate of candidates) {
      let nearest = Infinity;
      for (const point of chosen) nearest = Math.min(nearest, distance(point, candidate));
      if (nearest < minimumGap) continue;
      // No upper cap: the old 38-tile cap made distant empty regions invisible.
      const score = nearest * parameters.startSpacing + candidate.quality * .8 + candidate.tie * .3;
      if (score > bestScore) { best = candidate; bestScore = score; }
    }
    if (!best) return [];
    chosen.push(best);
  }
  for (let pass = 0; pass < Math.round(parameters.startRelaxations); pass++) {
    const regions = chosen.map(() => ({ x: 0, y: 0, count: 0, cells: [] as StartingSite[] }));
    for (const candidate of candidates) {
      let owner = 0, nearest = Infinity;
      for (let n = 0; n < chosen.length; n++) {
        const d = distance(candidate, chosen[n]);
        if (d < nearest) { nearest = d; owner = n; }
      }
      const region = regions[owner]; region.x += candidate.x; region.y += candidate.y; region.count++; region.cells.push(candidate);
    }
    for (let n = 0; n < chosen.length; n++) {
      const region = regions[n];
      if (!region.count) continue;
      const centroid = { x: region.x / region.count, y: region.y / region.count };
      const oldGap = Math.min(...chosen.filter((_, i) => i !== n).map(point => distance(point, chosen[n])));
      const allowedGap = Math.max(minimumGap, oldGap * .8);
      let best = chosen[n], bestScore = -Infinity;
      for (const candidate of region.cells) {
        let nearest = Infinity;
        for (let i = 0; i < chosen.length; i++) if (i !== n) nearest = Math.min(nearest, distance(candidate, chosen[i]));
        if (nearest < allowedGap) continue;
        const score = -distance(candidate, centroid) + Math.min(nearest, oldGap) * .12 * parameters.startSpacing
          + candidate.quality * .15 + candidate.tie * .02;
        if (score > bestScore) { best = candidate; bestScore = score; }
      }
      chosen[n] = best;
    }
  }
  return chosen;
}

/** Reserve all city footprints together when greedy realm-by-realm placement
 * jams a constrained map. Alternative deterministic seeds avoid committing
 * every retry to the same fertile corner, without relaxing viability or gaps. */
export function packSettlementSites(candidates: StartingSite[], count: number, minimumGap: number,
  parameters: LandscapeParameters = DEFAULT_LANDSCAPE_PARAMETERS): StartingSite[] {
  for (let attempt = 0; attempt < 16; attempt++) {
    const offset = Math.floor(attempt * candidates.length / 16);
    const packed = spreadFactionStarts([...candidates.slice(offset), ...candidates.slice(0, offset)], count, minimumGap, parameters);
    if (packed.length === count) return packed;
  }
  return [];
}
