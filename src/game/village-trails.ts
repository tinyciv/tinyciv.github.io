import TinyQueue from 'tinyqueue';
import { groundMovementMultiplier } from './geography';
import { canTraverseEdge, invalidateNavigation, traversable } from './pathfinding';
import type { RoadLinks } from './road-sprites';
import { markWorldChanged } from './world-revisions';
import { buildingHeight, buildingPresent, buildingWidth, isFarmKind, type GameState, type Point, type World, WATER } from './types';

export const VILLAGE_TRAIL_MAX_FORD_SPAN = 4;
const directions = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const;
interface Crossing { to: number; cells: number[]; }
export interface VillageTrailReport {
  villages: number;
  connectedVillages: number;
  components: number;
  routes: number;
  trailTiles: number;
  fordTiles: number;
  searchedPairs: number;
}

/** Terrain trails are generated scenery, never buildings or player orders. */
export function villageTrailLinks(world: World, x: number, y: number, roads?: ReadonlySet<number>): RoadLinks {
  const connected = (dx: number, dy: number): boolean => {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) return false;
    const cell = ny * world.width + nx;
    if (!canTraverseEdge(world, { x, y }, { x: nx, y: ny })) return false;
    if (dx && dy && (!traversable(world, nx, y) && !roads?.has(y * world.width + nx)
      || !traversable(world, x, ny) && !roads?.has(ny * world.width + x))) return false;
    return !!world.tiles[cell].villageTrail || !!roads?.has(cell);
  };
  return { north: connected(0, -1), east: connected(1, 0), south: connected(0, 1), west: connected(-1, 0),
    northeast: connected(1, -1), southeast: connected(1, 1), southwest: connected(-1, 1), northwest: connected(-1, -1) };
}

/** Call when a normal road is placed, including automatic/caravan roads.
 * The caller marks the world appearance changed alongside its road insertion. */
export function removeVillageTrailAt(world: World, x: number, y: number): boolean {
  const tile = world.tiles[Math.floor(y) * world.width + Math.floor(x)];
  if (!tile?.villageTrail) return false;
  delete tile.villageTrail; return true;
}

/** A small deterministic spanning network joins every reachable village group.
 * Search traverses real ground, stairs and existing fords. New crossings are
 * atomic straight river spans with two legal dry banks; open sea and lakes
 * never become a disguised bridge. Work is bounded to six searches per village
 * and one settled visit per map cell in each search. No per-frame upkeep. */
export function initializeVillageTrails(state: GameState): VillageTrailReport {
  const { world } = state, { width, height, tiles } = world, count = width * height;
  const villages = [...(state.villages ?? [])].filter(village => !village.destroyed).sort((a, b) => a.id - b.id);
  const report: VillageTrailReport = { villages: villages.length, connectedVillages: 0, components: villages.length,
    routes: 0, trailTiles: 0, fordTiles: 0, searchedPairs: 0 };
  if (villages.length < 2) return report;
  const blocked = new Uint8Array(count), roads = new Set<number>(), bridges = new Set<number>();
  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    if (building.kind === 'road' || building.kind === 'bridge') {
      const cell = building.y * width + building.x; roads.add(cell);
      if (building.kind === 'bridge') bridges.add(cell);
      continue;
    }
    if (!buildingPresent(building) || isFarmKind(building.kind) || building.kind === 'irrigation' || building.kind === 'ruin') continue;
    for (let y = building.y; y < building.y + buildingHeight(building); y++) for (let x = building.x; x < building.x + buildingWidth(building); x++)
      if (x >= 0 && y >= 0 && x < width && y < height) blocked[y * width + x] = 1;
  }
  const point = (cell: number): Point => ({ x: cell % width, y: Math.floor(cell / width) });
  const open = Uint8Array.from(tiles, (tile, cell) => Number(!blocked[cell] && (traversable(world, cell % width, Math.floor(cell / width))
    || bridges.has(cell) && WATER.has(tile.terrain) && !tile.ridge && !tile.stair)));
  const legalEdge = (from: number, to: number): boolean => canTraverseEdge(world, point(from), point(to));
  const dryBank = (cell: number): boolean => !!open[cell] && !WATER.has(tiles[cell].terrain) && !tiles[cell].ridge && !tiles[cell].stair;
  const crossings = new Map<number, Crossing[]>();
  for (let cell = 0; cell < count; cell++) {
    if (!dryBank(cell)) continue;
    const { x, y } = point(cell);
    for (const [dx, dy] of directions.slice(0, 4)) {
      const water: number[] = []; let previous = cell;
      for (let step = 1; step <= VILLAGE_TRAIL_MAX_FORD_SPAN + 1; step++) {
        const nx = x + dx * step, ny = y + dy * step;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) break;
        const next = ny * width + nx, tile = tiles[next];
        if (!legalEdge(previous, next)) break;
        if (dryBank(next)) {
          if (water.length) {
            const list = crossings.get(cell) ?? []; list.push({ to: next, cells: water }); crossings.set(cell, list);
          }
          break;
        }
        if (tile.terrain !== 'river' || tile.ridge || tile.stair || blocked[next] || water.length === VILLAGE_TRAIL_MAX_FORD_SPAN) break;
        water.push(next); previous = next;
      }
    }
  }
  const anchors = villages.map(village => {
    const candidates: number[] = [];
    for (let y = Math.max(0, village.y - 3); y <= Math.min(height - 1, village.y + 3); y++)
      for (let x = Math.max(0, village.x - 3); x <= Math.min(width - 1, village.x + 3); x++) if (open[y * width + x]) candidates.push(y * width + x);
    return candidates.sort((a, b) => Math.hypot(a % width - village.x, Math.floor(a / width) - village.y)
      - Math.hypot(b % width - village.x, Math.floor(b / width) - village.y) || a - b)[0];
  });
  const pairs: { a: number; b: number; distance: number }[] = [];
  for (let a = 0; a < villages.length; a++) for (let b = a + 1; b < villages.length; b++)
    pairs.push({ a, b, distance: Math.hypot(villages[a].x - villages[b].x, villages[a].y - villages[b].y) });
  pairs.sort((a, b) => a.distance - b.distance || villages[a.a].id - villages[b.a].id || villages[a.b].id - villages[b.b].id);
  const parents = villages.map((_, i) => i), root = (node: number): number => {
    while (parents[node] !== node) { parents[node] = parents[parents[node]]; node = parents[node]; } return node;
  };
  const costs = new Float64Array(count), previous = new Int32Array(count), closed = new Uint8Array(count);
  const search = (start: number, goal: number): number[] | undefined => {
    costs.fill(Infinity); previous.fill(-1); closed.fill(0); costs[start] = 0;
    const frontier = new TinyQueue<{ cell: number; cost: number }>([{ cell: start, cost: 0 }], (a, b) => a.cost - b.cost || a.cell - b.cell);
    while (frontier.length) {
      const current = frontier.pop()!, cell = current.cell;
      if (closed[cell]) continue; closed[cell] = 1;
      if (cell === goal) {
        const route = [goal];
        for (let next = goal; previous[next] >= 0;) {
          const prior = previous[next], a = point(next), b = point(prior), dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
          for (let x = a.x + dx, y = a.y + dy; x !== b.x || y !== b.y; x += dx, y += dy) route.push(y * width + x);
          route.push(prior); next = prior;
        }
        return route.reverse();
      }
      const { x, y } = point(cell);
      const visit = (next: number, weight: number): void => {
        if (closed[next]) return;
        const cost = current.cost + weight;
        if (cost >= costs[next]) return;
        costs[next] = cost; previous[next] = cell; frontier.push({ cell: next, cost });
      };
      for (const [dx, dy] of directions) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (!open[next] || !legalEdge(cell, next) || dx && dy && (!open[y * width + nx] || !open[ny * width + x])) continue;
        const terrain = tiles[next].villageTrail || roads.has(next) ? .7 : 1 / groundMovementMultiplier(tiles[next]);
        visit(next, (dx && dy ? Math.SQRT2 : 1) * terrain * (1 + tiles[next].variation * .08));
      }
      for (const crossing of crossings.get(cell) ?? [])
        visit(crossing.to, 2 + (crossing.cells.length + 1) / .45);
    }
  };
  const newlyForded = new Set<number>();
  for (const pair of pairs) {
    if (root(pair.a) === root(pair.b) || anchors[pair.a] === undefined || anchors[pair.b] === undefined) continue;
    if (report.searchedPairs >= Math.max(12, villages.length * 6)) break;
    report.searchedPairs++;
    const route = search(anchors[pair.a]!, anchors[pair.b]!); if (!route) continue;
    for (let i = 0; i < route.length; i++) {
      const cell = route[i], tile = tiles[cell];
      if (!roads.has(cell)) tile.villageTrail = true;
      if (tile.terrain === 'river' && tile.overlay !== 'ford') {
        tile.overlay = 'ford'; tile.fordAxis = Math.abs(route[i - 1] - cell) === 1 ? 'horizontal' : 'vertical'; newlyForded.add(cell);
      }
    }
    parents[root(pair.b)] = root(pair.a); report.routes++;
  }
  const sizes = new Map<number, number>();
  for (let i = 0; i < villages.length; i++) sizes.set(root(i), (sizes.get(root(i)) ?? 0) + 1);
  report.components = sizes.size;
  report.connectedVillages = [...sizes.values()].filter(size => size > 1).reduce((sum, size) => sum + size, 0);
  report.trailTiles = tiles.filter(tile => tile.villageTrail).length; report.fordTiles = newlyForded.size;
  if (report.routes) { markWorldChanged(world, newlyForded.size ? 'geometry' : 'appearance'); invalidateNavigation(state); }
  return report;
}
