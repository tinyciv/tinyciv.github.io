import { updateFog, type FogView } from './fog';
import { playerFaction, withPlayerFaction } from './player-context';
import { unitRespectsForbidden } from './forbidden-zones';
import { createReachabilityQuery, findPath, movementMultiplier, withNavigationFrame } from './pathfinding';
import { distance, type GameState, type Point, type Unit, type World } from './types';

export interface ScoutThreat extends Point { radius: number }
export interface ScoutExplorationRoute { goal: Point; path: Point[] }
interface FrontierBoard {
  world: World; fog?: FogView; nextFogAt: number; nextScanAt: number; explorationRevision: number;
  explored?: number[]; frontiers: number[]; lastTime: number;
  reservations: Map<number, { point: Point; until: number }>;
}
const boards = new WeakMap<GameState, Map<number, FrontierBoard>>();
const pointAt = (cell: number, width: number): Point => ({ x: cell % width + .5, y: Math.floor(cell / width) + .5 });

/** NPC exploration has its own saved knowledge. Temporarily selecting an NPC
 * for fog calculation must never replace the human player's explored map. */
function explorationFog(state: GameState, faction: number): FogView {
  if (state.multiplayer || faction === playerFaction(state)) return updateFog(state, faction);
  const previousFog = state.fog;
  try {
    return withPlayerFaction(state, faction, () => {
      state.fog = state.scoutExploration?.[faction];
      const fog = updateFog(state);
      (state.scoutExploration ??= {})[faction] = state.fog!;
      return fog;
    });
  } finally { state.fog = previousFog; }
}
function boardFor(state: GameState, faction: number): FrontierBoard {
  let factions = boards.get(state);
  if (!factions) { factions = new Map(); boards.set(state, factions); }
  let board = factions.get(faction);
  if (!board || board.world !== state.world || state.time < board.lastTime) {
    board = { world: state.world, nextFogAt: -Infinity, nextScanAt: -Infinity,
      explorationRevision: -1, frontiers: [], lastTime: state.time, reservations: new Map() };
    factions.set(faction, board);
  }
  board.lastTime = state.time;
  return board;
}
function refreshFrontiers(state: GameState, faction: number): FrontierBoard {
  const board = boardFor(state, faction), { width, height } = state.world;
  if (!board.fog || state.time >= board.nextFogAt) {
    board.fog = explorationFog(state, faction); board.nextFogAt = state.time + .5;
  }
  const fog = board.fog;
  if (board.explored !== fog.explored || board.explorationRevision !== fog.explorationRevision && state.time >= board.nextScanAt) {
    board.frontiers = [];
    for (let cell = 0; cell < width * height; cell++) {
      if (fog.explored[cell]) continue;
      const x = cell % width, y = Math.floor(cell / width);
      if (x && fog.explored[cell - 1] || x + 1 < width && fog.explored[cell + 1]
        || y && fog.explored[cell - width] || y + 1 < height && fog.explored[cell + width]) board.frontiers.push(cell);
    }
    board.explored = fog.explored; board.explorationRevision = fog.explorationRevision; board.nextScanAt = state.time + 1.25;
  }
  for (const [id, reservation] of board.reservations) if (reservation.until < state.time
    || !state.units.some(unit => unit.id === id && unit.faction === faction && unit.hp > 0 && unit.kind === 'scout')) board.reservations.delete(id);
  return board;
}
export function reserveScoutExplorationGoal(state: GameState, scout: Unit, point?: Point): void {
  const board = boardFor(state, scout.faction);
  if (point) board.reservations.set(scout.id, { point: { ...point }, until: state.time + 10 });
  else board.reservations.delete(scout.id);
}
function unknownNearby(explored: readonly number[], point: Point, width: number, height: number): number {
  let count = 0;
  for (let y = Math.max(0, Math.floor(point.y) - 4); y <= Math.min(height - 1, Math.floor(point.y) + 4); y++)
    for (let x = Math.max(0, Math.floor(point.x) - 4); x <= Math.min(width - 1, Math.floor(point.x) + 4); x++)
      if (!explored[y * width + x] && (x + .5 - point.x) ** 2 + (y + .5 - point.y) ** 2 <= 16) count++;
  return count;
}

/** Only frontier selection scans the map. Nearby alternatives are shortlisted
 * first; at most eight weighted routes are searched, never one per fog cell.
 * Goals remain leased while walking so scouts do not repeatedly trade targets. */
export function chooseScoutExplorationRoute(state: GameState, scout: Unit, failed: ReadonlyMap<number, number>, threats: readonly ScoutThreat[]): ScoutExplorationRoute | undefined {
  return withNavigationFrame(state, () => {
    const board = refreshFrontiers(state, scout.faction), explored = board.fog!.explored, { width, height } = state.world;
    const avoidForbidden = unitRespectsForbidden(state, scout);
    const reachable = createReachabilityQuery(state, scout, scout.faction, undefined, avoidForbidden);
    const reservations = [...board.reservations].filter(([id]) => id !== scout.id).map(([, value]) => value.point);
    const failures = [...failed].filter(([, until]) => until > state.time).map(([cell]) => pointAt(cell, width));
    const risk = (point: Point): boolean => threats.some(threat => distance(point, threat) < threat.radius + .15);
    const candidates: { point: Point; score: number; overlap: number; gain: number }[] = [];
    for (const cell of board.frontiers) {
      if (explored[cell]) continue;
      const point = pointAt(cell, width);
      if (!reachable(point) || risk(point) || failures.some(failure => distance(point, failure) < 3)
        || reservations.some(reservation => distance(point, reservation) < 3)) continue;
      const overlap = reservations.reduce((sum, reservation) => sum + Math.max(0, 10 - distance(point, reservation)) * 1.5, 0);
      const gain = unknownNearby(explored, point, width, height);
      candidates.push({ point, overlap, gain, score: distance(scout, point) / Math.max(.1, scout.speed) + overlap - gain * .025 });
    }
    candidates.sort((a, b) => a.score - b.score || a.point.y - b.point.y || a.point.x - b.point.x);
    const shortlist: typeof candidates = [];
    for (const candidate of candidates) {
      if (shortlist.some(other => distance(candidate.point, other.point) < 3)) continue;
      shortlist.push(candidate); if (shortlist.length === 8) break;
    }
    const threatenedCells = new Set<number>();
    for (const threat of threats) {
      for (let y = Math.max(0, Math.floor(threat.y - threat.radius - 1)); y <= Math.min(height - 1, Math.ceil(threat.y + threat.radius + 1)); y++)
        for (let x = Math.max(0, Math.floor(threat.x - threat.radius - 1)); x <= Math.min(width - 1, Math.ceil(threat.x + threat.radius + 1)); x++)
          if (Math.hypot(x + .5 - threat.x, y + .5 - threat.y) < threat.radius + .15) threatenedCells.add(y * width + x);
    }
    let best: ScoutExplorationRoute | undefined, bestScore = Infinity;
    for (const candidate of shortlist) {
      const path = findPath(state, scout, candidate.point, scout.faction, false,
        threatenedCells.size ? threatenedCells : undefined, undefined, undefined, false, avoidForbidden);
      if (!path.length) continue;
      let previous: Point = scout, seconds = 0;
      for (const next of path) {
        seconds += distance(previous, next) / Math.max(.05, Math.min(movementMultiplier(state, previous.x, previous.y), movementMultiplier(state, next.x, next.y)) * scout.speed);
        previous = next;
      }
      const score = seconds + candidate.overlap - candidate.gain * .025;
      if (score < bestScore) { bestScore = score; best = { goal: candidate.point, path }; }
    }
    reserveScoutExplorationGoal(state, scout, best?.goal);
    return best;
  });
}
