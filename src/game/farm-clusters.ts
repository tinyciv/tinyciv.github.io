import { isFarmKind, type Building, type GameState, type Point } from './types';

export interface ClusterOptions {
  excludeCamp?: number;
  /** Footprints being redeveloped cannot anchor the new crop block. */
  vacatedCells?: ReadonlySet<number>;
  /** Earlier destinations in an atomic relocation count as neighboring crops. */
  plannedCells?: ReadonlySet<number>;
}

/** A bounded preference: joining a crop edge matters most; extra neighbors
 * fill holes and corners instead of extending a thin row indefinitely. */
export function farmCompactnessQuery(state: GameState, faction: number, options: ClusterOptions = {}): (x: number, y: number) => number {
  const { width, height } = state.world, crops = new Set(options.plannedCells);
  for (const building of state.buildings) {
    const cell = building.y * width + building.x;
    if (building.hp > 0 && building.faction === faction && isFarmKind(building.kind)
      && building.id !== options.excludeCamp && !options.vacatedCells?.has(cell)) crops.add(cell);
  }
  const cropAt = (x: number, y: number): number => Number(x >= 0 && y >= 0 && x < width && y < height && crops.has(y * width + x));
  return (x, y) => {
    const cardinal = cropAt(x - 1, y) + cropAt(x + 1, y) + cropAt(x, y - 1) + cropAt(x, y + 1);
    const diagonal = cropAt(x - 1, y - 1) + cropAt(x + 1, y - 1) + cropAt(x - 1, y + 1) + cropAt(x + 1, y + 1);
    return ((cardinal ? 12 + cardinal : 0) + diagonal * .5) / 18;
  };
}

interface ParcelBand { start: number; size: number; }

/** Mixed-width planting bands leave one ordinary ground cell
 * between parcels. The settlement anchors the pattern, so completing a field
 * does not move its intended edges and no saved reservations are necessary. */
function parcelBands(length: number, origin: number, salt: number, spans: readonly number[]): (ParcelBand | undefined)[] {
  const bands: (ParcelBand | undefined)[] = new Array(length);
  const span = (index: number): number => {
    let hash = Math.imul(index ^ salt, 0x45d9f3b); hash ^= hash >>> 16;
    return spans[(hash >>> 0) % spans.length];
  };
  const fill = (start: number, size: number): void => {
    const band = { start, size };
    for (let cell = Math.max(0, start); cell < Math.min(length, start + size); cell++) bands[cell] = band;
  };
  for (let start = origin, index = 0; start < length; index++) {
    const size = span(index); fill(start, size); start += size + 1;
  }
  for (let end = origin - 1, index = -1; end > 0; index--) {
    const size = span(index); fill(end - size, size); end -= size + 1;
  }
  return bands;
}

interface SquareParcel { x: number; y: number; size: number; planted: number; nearby: boolean; }

/** Complete viable 2×2/3×3 squares before starting more fields. Empty parcels
 * retain stable settlement-anchored spacing; incomplete older/manual fields
 * can finish a square off that grid. All missing cells must be suitable, with
 * a clear one-cell farm gap around the final square. This is only a bounded
 * score: stronger production/access can still choose a compact fallback. */
export function farmParcelPreferenceQuery(state: GameState, palace: Building, sites: readonly Point[], options: ClusterOptions = {}): (x: number, y: number) => number {
  const { width, height } = state.world, crops = new Set(options.plannedCells), allCrops = new Set(options.plannedCells);
  for (const building of state.buildings) {
    const cell = building.y * width + building.x;
    if (building.hp <= 0 || !isFarmKind(building.kind) || building.id === options.excludeCamp || options.vacatedCells?.has(cell)) continue;
    allCrops.add(cell); if (building.faction === palace.faction) crops.add(cell);
  }
  const available = new Set(sites.map(point => point.y * width + point.x));
  const columns = parcelBands(width, palace.x, palace.id * 31 + 17, [2, 3]);
  const rows = parcelBands(height, palace.y, palace.id * 47 + 59, [2, 3]);
  const compactness = farmCompactnessQuery(state, palace.faction, options), bonuses = new Map<number, number>(), checked = new Set<string>();
  const neighbors = (x: number, y: number): number[] => [x > 0 ? y * width + x - 1 : -1,
    x + 1 < width ? y * width + x + 1 : -1, y > 0 ? (y - 1) * width + x : -1, y + 1 < height ? (y + 1) * width + x : -1];
  const viable = (x: number, y: number, size: number): SquareParcel | undefined => {
    if (x < 0 || y < 0 || x + size > width || y + size > height) return;
    let planted = 0, nearby = false;
    for (let py = y; py < y + size; py++) for (let px = x; px < x + size; px++) {
      const cell = py * width + px;
      if (crops.has(cell)) planted++; else if (!available.has(cell)) return;
    }
    for (let py = Math.max(0, y - 2); py <= Math.min(height - 1, y + size + 1); py++)
      for (let px = Math.max(0, x - 2); px <= Math.min(width - 1, x + size + 1); px++) {
        if (!allCrops.has(py * width + px)) continue;
        const gap = Math.max(x - px, px - x - size + 1, y - py, py - y - size + 1);
        if (gap === 1) return;
        if (gap === 2) nearby = true;
      }
    return { x, y, size, planted, nearby };
  };
  const apply = (parcel: SquareParcel, startWeight = 1): void => {
    const { x, y, size, planted, nearby } = parcel;
    for (let py = y; py < y + size; py++) for (let px = x; px < x + size; px++) {
      const cell = py * width + px;
      if (crops.has(cell) || !available.has(cell) || planted && !neighbors(px, py).some(cell => crops.has(cell))) continue;
      const score = planted ? .9 + .06 * planted / (size * size) + compactness(px, py) * .04 : (nearby ? .3 : .2) * startWeight;
      bonuses.set(cell, Math.max(bonuses.get(cell) ?? 0, score));
    }
  };
  const grid: SquareParcel[] = [];
  for (const point of sites) {
    const column = columns[point.x], row = rows[point.y]; if (!column || !row) continue;
    const size = Math.min(column.size, row.size), key = `${column.start},${row.start},${size}`;
    if (checked.has(key)) continue; checked.add(key);
    const parcel = viable(column.start, row.start, size);
    if (parcel) grid.push(parcel);
  }
  const visited = new Set<number>();
  for (const first of crops) {
    if (visited.has(first)) continue;
    const group = [first]; visited.add(first);
    let minX = first % width, maxX = minX, minY = Math.floor(first / width), maxY = minY;
    for (let i = 0; i < group.length; i++) {
      const x = group[i] % width, y = Math.floor(group[i] / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const neighbor of neighbors(x, y)) if (crops.has(neighbor) && !visited.has(neighbor)) { visited.add(neighbor); group.push(neighbor); }
    }
    const spanX = maxX - minX + 1, spanY = maxY - minY + 1;
    if (spanX > 3 || spanY > 3) continue;
    const existing = grid.find(parcel => parcel.x <= minX && parcel.y <= minY && parcel.x + parcel.size > maxX && parcel.y + parcel.size > maxY);
    if (existing) { apply(existing); continue; }
    // Four cells can be the first corner of an intended 3×3 square. Preserve
    // that larger target before treating an independent 2×2 as finished.
    if (spanX === spanY && group.length === spanX * spanY && spanX >= 2) continue;
    // A deterministic compact completion also repairs partial parcels which
    // predate the grid, without relocating farms or reserving unusable terrain.
    for (const size of [2, 3]) {
      if (size < spanX || size < spanY) continue;
      let best: SquareParcel | undefined, bestDistance = Infinity;
      for (let y = maxY - size + 1; y <= minY; y++) for (let x = maxX - size + 1; x <= minX; x++) {
        const parcel = viable(x, y, size); if (!parcel) continue;
        const distance = Math.hypot(x + size / 2 - palace.x - 1, y + size / 2 - palace.y - 1);
        if (distance < bestDistance) { best = parcel; bestDistance = distance; }
      }
      if (best) { apply(best); break; }
    }
  }
  // Starting a fresh square must not compete with finishing the far corner
  // of a viable one. Retain a tiny grid tie-break if substantially better
  // soil or access still wins over every available completion.
  const completing = bonuses.size > 0;
  for (const parcel of grid) if (!parcel.planted) apply(parcel, completing ? .02 : 1);
  if (!bonuses.size) return compactness;
  return (x, y) => Math.min(1, bonuses.get(y * width + x) ?? (completing ? 0 : compactness(x, y) * .05));
}

/** Relocation compactness never compensates for more than 1.5 extra walking tiles. */
export const FARM_CLUSTER_WALKING_BIAS = 1.5;
/** A layout preference, not extra crop yield: strong soil/irrigation and delivery advantages still win. */
export const FARM_CLUSTER_PRODUCTION_BONUS = .2;
