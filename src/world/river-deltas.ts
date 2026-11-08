import { createNoise2D } from 'simplex-noise';
import { WATER, type Tile, type World } from '../game/types';
import { environmentRandom, terrainDistance } from './environment-fields';
import { refreshRiverRunoff, repairRiverDrainage } from './river-network';

export interface RiverDelta {
  id: number;
  mouth: number;
  discharge: number;
  cells: number[];
  marshCells: number[];
  waterCells: number[];
  distributaries: number[][];
  bounds: { x: number; y: number; width: number; height: number };
  direction: { x: number; y: number };
  suitability: number;
  waterFraction: number;
}

const sea = (tile: Tile) => tile.terrain === 'ocean' || tile.terrain === 'coast';
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Sediment fans and tidal marsh mosaics at substantial, low-relief river mouths.
 * This is a deterministic landscape model, not a sediment/tide simulation.
 * Existing freshwater spines and their receivers are never filled by sediment.
 */
export function generateRiverDeltas(world: World): RiverDelta[] {
  const { width, height, tiles } = world, count = tiles.length;
  if (Math.min(width, height) < 128) return [];
  const neighbors = (cell: number): number[] => {
    const x = cell % width, y = Math.floor(cell / width), result: number[] = [];
    if (x) result.push(cell - 1); if (x + 1 < width) result.push(cell + 1);
    if (y) result.push(cell - width); if (y + 1 < height) result.push(cell + width);
    return result;
  };
  const beforeSea = Uint8Array.from(tiles, tile => Number(sea(tile)));
  const beforeElevation = Float64Array.from(tiles, tile => tile.elevation);
  const coastalDistance = terrainDistance(world, tile => !WATER.has(tile.terrain));
  // Every coastal receiver retains an actual route to the open ocean. A sea
  // label alone is insufficient: sediment can otherwise enclose that cell.
  const seaExit = new Int32Array(count).fill(-2), openSea: number[] = [];
  for (let cell = 0; cell < count; cell++) if (beforeSea[cell]
    && (cell % width === 0 || cell % width === width - 1 || cell < width || cell >= count - width)) {
    seaExit[cell] = -1; openSea.push(cell);
  }
  for (let n = 0; n < openSea.length; n++) for (const next of neighbors(openSea[n]))
    if (WATER.has(tiles[next].terrain) && seaExit[next] === -2) { seaExit[next] = openSea[n]; openSea.push(next); }
  // Some older coastline patches are enclosed inland basins. A delta fan may
  // extend beside another catchment, but never into one of those closed sinks.
  const oceanDraining = new Int8Array(count).fill(-1);
  for (let start = 0; start < count; start++) if (oceanDraining[start] < 0) {
    const path: number[] = []; let at = start, connected = 0;
    while (at >= 0 && oceanDraining[at] < 0) {
      path.push(at);
      const next = tiles[at].drainage ?? -1;
      if (next < 0) { connected = Number(!!beforeSea[at] && seaExit[at] !== -2); at = -1; break; }
      at = next;
    }
    if (at >= 0) connected = oceanDraining[at];
    for (const cell of path) oceanDraining[cell] = connected;
  }
  const reliefApron = new Uint8Array(count);
  for (let cell = 0; cell < count; cell++) if (tiles[cell].ridge || tiles[cell].stair || tiles[cell].canyon === 'wall') {
    const x = cell % width, y = Math.floor(cell / width);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) reliefApron[ny * width + nx] = 1;
    }
  }
  const protectedWater = new Uint8Array(count);
  for (let cell = 0; cell < count; cell++) if (tiles[cell].terrain === 'river' || tiles[cell].terrain === 'lake') {
    protectedWater[cell] = 1;
    const next = tiles[cell].drainage ?? -1;
    if (next >= 0 && WATER.has(tiles[next].terrain)) protectedWater[next] = 1;
  }
  for (let cell = 0; cell < count; cell++) {
    const tile = tiles[cell], next = tile.drainage ?? -1;
    // Drainage receivers can be diagonal. Protect the cardinal water path
    // starting at the mouth itself, including its coastal elbow, so sediment
    // cannot sever a river while leaving its diagonal receiver untouched.
    if ((tile.terrain === 'river' || tile.terrain === 'lake') && next >= 0 && beforeSea[next] && seaExit[cell] !== -2)
      for (let at = cell; at >= 0; at = seaExit[at]) protectedWater[at] = 1;
  }
  const candidates = tiles.flatMap((tile, mouth) => tile.channel && tile.terrain === 'river'
    && (tile.drainage ?? -1) >= 0 && beforeSea[tile.drainage!] && seaExit[tile.drainage!] !== -2 && (tile.flow ?? 0) >= 90
    ? [{ mouth, discharge: tile.flow! }] : []).sort((a, b) => b.discharge - a.discharge);
  const result: RiverDelta[] = [];
  const modified = new Uint8Array(count);
  for (const { mouth, discharge } of candidates) {
    const mx = mouth % width, my = Math.floor(mouth / width);
    if (result.some(delta => Math.hypot(delta.mouth % width - mx, Math.floor(delta.mouth / width) - my) < 25)) continue;
    const random = environmentRandom(`${world.seed}:delta:${mouth}`), noise = createNoise2D(random);
    let bankCount = 0, lowBanks = 0, shelter = 0, seaCount = 0;
    let sx = 0, sy = 0;
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      const x = mx + dx, y = my + dy;
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2 || dx * dx + dy * dy > 64) continue;
      const cell = y * width + x, tile = tiles[cell];
      if (beforeSea[cell]) { seaCount++; sx += dx; sy += dy; if (coastalDistance[cell] <= 4) shelter++; }
      else if (!WATER.has(tile.terrain)) {
        bankCount++;
        if (!tile.ridge && !tile.relief && !tile.canyon && tile.elevation < .48) lowBanks++;
      }
    }
    const flatness = lowBanks / Math.max(1, bankCount), sheltered = shelter / Math.max(1, seaCount);
    const suitability = flatness * .8 + sheltered * .2;
    if (bankCount < 12 || flatness < .58 || suitability < .58 || random() > .84 + sheltered * .1) continue;
    const receiver = tiles[mouth].drainage!, rx = receiver % width - mx, ry = Math.floor(receiver / width) - my;
    // The local open-water centroid gives the lobe its seaward direction;
    // the final river step stabilizes narrow or symmetric bays.
    const oceanLength = Math.hypot(sx, sy) || 1;
    let ax = sx / oceanLength * .72 + rx * .28, ay = sy / oceanLength * .72 + ry * .28;
    const length = Math.hypot(ax, ay) || 1; ax /= length; ay /= length;
    const size = clamp(10 + Math.sqrt(discharge) * .24, 13, 19), inland = size * .62;
    const candidate = new Uint8Array(count), cells: number[] = [];
    const search = Math.ceil(size * 1.65);
    for (let y = Math.max(2, my - search); y <= Math.min(height - 3, my + search); y++)
      for (let x = Math.max(2, mx - search); x <= Math.min(width - 3, mx + search); x++) {
        const cell = y * width + x, tile = tiles[cell], dx = x - mx, dy = y - my;
        if (!oceanDraining[cell] || tile.delta || reliefApron[cell] || tile.ridge || tile.relief || tile.canyon || (!WATER.has(tile.terrain) && tile.elevation > .48)) continue;
        const along = dx * ax + dy * ay, across = -dx * ay + dy * ax;
        const center = size * .18, forward = size * .82 + inland * .5;
        const fanWidth = size * (.56 + clamp((along + inland) / (size + inland), 0, 1) * .40);
        const shape = ((along - center) / forward) ** 2 + (across / fanWidth) ** 2;
        const edge = 1 + noise(x * .16 + 31, y * .16 - 71) * .17;
        if (along < -inland || shape > edge || beforeSea[cell] && coastalDistance[cell] > size * .85) continue;
        candidate[cell] = 1; cells.push(cell);
      }
    if (cells.length < 140 || !candidate[mouth]) continue;
    const wet = protectedWater.slice(), paths: number[][] = [];
    const endpoints = cells.filter(cell => beforeSea[cell] && neighbors(cell).some(next => beforeSea[next] && !candidate[next]));
    if (endpoints.length < 3) continue;
    const route = (target: number, side: number): number[] => {
      const distance = new Map<number, number>([[mouth, 0]]), parents = new Map<number, number>(), open = [mouth], closed = new Set<number>();
      const tx = target % width, ty = Math.floor(target / width);
      while (open.length) {
        let best = 0, bestScore = Infinity;
        for (let n = 0; n < open.length; n++) {
          const cell = open[n], score = distance.get(cell)! + Math.abs(cell % width - tx) + Math.abs(Math.floor(cell / width) - ty);
          if (score < bestScore) { best = n; bestScore = score; }
        }
        const at = open[best]; open[best] = open[open.length - 1]; open.pop();
        if (at === target) { const path = [at]; while (path[path.length - 1] !== mouth) path.push(parents.get(path[path.length - 1])!); return path.reverse(); }
        if (closed.has(at)) continue; closed.add(at);
        for (const next of neighbors(at)) {
          if (!candidate[next] || closed.has(next)) continue;
          const x = next % width, y = Math.floor(next / width);
          const cost = 1.05 + (noise(x * .22 + side * 13, y * .22 - side * 7) + 1) * .85;
          const value = distance.get(at)! + cost;
          if (value >= (distance.get(next) ?? Infinity)) continue;
          distance.set(next, value); parents.set(next, at); open.push(next);
        }
      }
      return [];
    };
    const branchCount = discharge > 450 ? 4 : 3;
    const usedEndpoints = new Set<number>();
    for (let branch = 0; branch < branchCount; branch++) {
      const side = branch / (branchCount - 1) * 2 - 1;
      const targetAcross = side * size * .63, targetAlong = size * (.8 - Math.abs(side) * .2);
      const endpoint = endpoints.filter(cell => !usedEndpoints.has(cell)).sort((a, b) => {
        const score = (cell: number) => { const dx = cell % width - mx, dy = Math.floor(cell / width) - my;
          return Math.abs(dx * ax + dy * ay - targetAlong) * .8 + Math.abs(-dx * ay + dy * ax - targetAcross); };
        return score(a) - score(b);
      })[0];
      if (endpoint === undefined) continue;
      usedEndpoints.add(endpoint);
      const path = route(endpoint, branch);
      if (path.length < 5) continue;
      paths.push(path); path.forEach(cell => wet[cell] = 1);
    }
    if (paths.length < 2) continue;

    // A randomized growing mesh retains land access at each bank, with no
    // solid 2x2 interiors. The two binary states are actual land and water.
    const dry = new Uint8Array(count), frontier: number[] = [], queued = new Uint8Array(count);
    const createsSquare = (cell: number) => {
      const x = cell % width, y = Math.floor(cell / width);
      for (const ox of [-1, 0]) for (const oy of [-1, 0]) {
        if (x + ox < 0 || y + oy < 0 || x + ox + 1 >= width || y + oy + 1 >= height) continue;
        const corner = (y + oy) * width + x + ox;
        if ([corner, corner + 1, corner + width, corner + width + 1].every(next => next === cell || dry[next])) return true;
      }
      return false;
    };
    const grow = (cell: number) => {
      dry[cell] = 1;
      for (const next of neighbors(cell)) if (candidate[next] && !wet[next] && !dry[next] && !queued[next]) { queued[next] = 1; frontier.push(next); }
    };
    const shuffled = cells.map(cell => ({ cell, rank: random() })).sort((a, b) => a.rank - b.rank).map(({ cell }) => cell);
    for (const cell of shuffled) if (!wet[cell] && !beforeSea[cell] && !WATER.has(tiles[cell].terrain)
      && neighbors(cell).some(next => !candidate[next] && !WATER.has(tiles[next].terrain) && !tiles[next].ridge) && !createsSquare(cell)) grow(cell);
    if (!frontier.length) continue;
    let landCount = cells.reduce((sum, cell) => sum + dry[cell], 0), targetLand = Math.round(cells.length * .52);
    while (frontier.length && landCount < targetLand) {
      const pick = Math.floor(random() * frontier.length), cell = frontier[pick]; frontier[pick] = frontier[frontier.length - 1]; frontier.pop();
      if (dry[cell] || createsSquare(cell)) continue;
      grow(cell); landCount++;
    }
    if (landCount < cells.length * .32) continue;
    const id = result.length + 1;
    for (const cell of cells) {
      const tile = tiles[cell]; tile.delta = id;
      // Existing river/lake topology and elevations are immutable within fans.
      if (protectedWater[cell]) continue;
      modified[cell] = 1;
      delete tile.treeClass; delete tile.palm; delete tile.beach; delete tile.resource; delete tile.fordAxis;
      tile.overlay = 'none'; tile.moisture = Math.max(tile.moisture, .88); tile.sediment = Math.max(tile.sediment ?? 0, .8);
      if (dry[cell]) { tile.terrain = 'grassland'; tile.marsh = true; tile.biome = 'wetland'; }
      else { tile.terrain = 'coast'; delete tile.marsh; }
    }
    const minX = Math.min(...cells.map(cell => cell % width)), maxX = Math.max(...cells.map(cell => cell % width));
    const minY = Math.min(...cells.map(cell => Math.floor(cell / width))), maxY = Math.max(...cells.map(cell => Math.floor(cell / width)));
    result.push({ id, mouth, discharge, cells, marshCells: cells.filter(cell => dry[cell]), waterCells: cells.filter(cell => !dry[cell]),
      distributaries: paths, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      direction: { x: ax, y: ay }, suitability, waterFraction: 1 - landCount / cells.length });
  }
  if (!result.length) return result;

  // Tidal cells are sea-connected. Enclosed marsh pools retain their original
  // ground receiver and level: their spill/groundwater accounting remains in
  // the original acyclic catchment rather than inventing duplicate discharge.
  const tidal = new Uint8Array(count), tidalQueue: number[] = [];
  for (let cell = 0; cell < count; cell++) if (sea(tiles[cell])
    && (cell % width === 0 || cell % width === width - 1 || cell < width || cell >= count - width)) { tidal[cell] = 1; tidalQueue.push(cell); }
  for (let n = 0; n < tidalQueue.length; n++) for (const next of neighbors(tidalQueue[n]))
    if (!tidal[next] && WATER.has(tiles[next].terrain)) { tidal[next] = 1; tidalQueue.push(next); }
  for (let cell = 0; cell < count; cell++) if (modified[cell] && WATER.has(tiles[cell].terrain)) {
    if (tidal[cell]) { tiles[cell].terrain = 'coast'; tiles[cell].elevation = 0; tiles[cell].drainage = -1; }
    else { tiles[cell].terrain = 'lake'; tiles[cell].elevation = beforeElevation[cell]; }
  }
  // If deposition encloses a previously tidal pocket just beyond the noisy
  // footprint, it becomes a pond rather than a false sea sink. Its receiver
  // is assigned by the same former-sea routing field as the new marsh land.
  for (let cell = 0; cell < count; cell++) if (beforeSea[cell] && oceanDraining[cell] && !tidal[cell] && sea(tiles[cell]))
    tiles[cell].terrain = 'lake';
  // Former sea nodes had no upstream receiver. Reconnect newly deposited land
  // only inside that former-sea domain, so it cannot backedge into old rivers.
  const oldSeaDistance = new Int16Array(count).fill(-1), seaQueue: number[] = [];
  for (let cell = 0; cell < count; cell++) if (beforeSea[cell] && sea(tiles[cell]) && tidal[cell]) { oldSeaDistance[cell] = 0; seaQueue.push(cell); }
  for (let n = 0; n < seaQueue.length; n++) for (const next of neighbors(seaQueue[n])) {
    if (!beforeSea[next] || oldSeaDistance[next] >= 0) continue;
    oldSeaDistance[next] = oldSeaDistance[seaQueue[n]] + 1; tiles[next].drainage = seaQueue[n];
    tiles[next].elevation = tiles[seaQueue[n]].elevation + .00001;
    seaQueue.push(next);
  }
  // Extend the ordinary shallow coastal band around newly deposited land.
  const finalCoast = terrainDistance(world, tile => !WATER.has(tile.terrain), 3);
  for (let cell = 0; cell < count; cell++) if (sea(tiles[cell]) && finalCoast[cell] <= 2) tiles[cell].terrain = 'coast';
  refreshRiverRunoff(world); repairRiverDrainage(world);
  for (const delta of result) delta.discharge = tiles[delta.mouth].flow ?? delta.discharge;
  return result;
}
