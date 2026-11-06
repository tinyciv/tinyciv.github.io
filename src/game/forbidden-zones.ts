import { playerFaction, playerControl, isHumanFaction } from './player-context';
import type { GameState, Point, Unit } from './types';

export interface ForbiddenRegion {
  id: number;
  cells: readonly number[];
  /** Area centroid, moved onto the nearest member tile when it falls outside a concave zone. */
  center: Point;
}

interface ZoneCache {
  source: GameState['forbiddenZones'];
  revision: number;
  width: number;
  height: number;
  cells: ReadonlySet<number>;
  regions?: readonly ForbiddenRegion[];
}
const caches = new WeakMap<GameState, Map<number, ZoneCache>>();
const zones = (state: GameState, faction: number) => state.multiplayer ? state.multiplayer.controls[faction]?.forbiddenZones : state.forbiddenZones;

export const forbiddenRevision = (state: GameState, faction?: number): number => state.multiplayer
  ? faction === undefined ? Object.values(state.multiplayer.controls).reduce((sum, control) => sum + (control.forbiddenZones?.revision ?? 0), 0)
    : zones(state, faction)?.revision ?? 0 : state.forbiddenZones?.revision ?? 0;

function zoneCache(state: GameState, faction = playerFaction(state)): ZoneCache {
  const { width, height } = state.world, source = zones(state, faction), revision = forbiddenRevision(state, faction);
  let byFaction = caches.get(state); if (!byFaction) { byFaction = new Map(); caches.set(state, byFaction); }
  let cache = byFaction.get(faction);
  if (!cache || cache.source !== source || cache.revision !== revision || cache.width !== width || cache.height !== height) {
    cache = { source, revision, width, height,
      cells: new Set((source?.cells ?? []).filter(cell => Number.isInteger(cell) && cell >= 0 && cell < width * height)) };
    byFaction.set(faction, cache);
  }
  return cache;
}

export const forbiddenCells = (state: GameState, faction = playerFaction(state)): ReadonlySet<number> => zoneCache(state, faction).cells;

export function factionRespectsForbidden(state: GameState, faction: number): boolean {
  if (state.multiplayer) return isHumanFaction(state, faction);
  return faction === 0 || state.factions.some(candidate => candidate.id === faction && candidate.relation === 'confederated')
    || !!state.villages?.some(village => village.faction === faction && village.relation === 'allied' && !village.destroyed);
}

export function isForbidden(state: GameState, x: number, y: number, faction = playerFaction(state)): boolean {
  if (!zones(state, faction)?.cells.length || !factionRespectsForbidden(state, faction)) return false;
  const tx = Math.floor(x), ty = Math.floor(y);
  return tx >= 0 && ty >= 0 && tx < state.world.width && ty < state.world.height
    && forbiddenCells(state, faction).has(ty * state.world.width + tx);
}

/** Only the Leader and combat retinue may ignore forbidden work areas. */
export function unitRespectsForbidden(state: GameState, unit: Pick<Unit, 'kind' | 'faction' | 'villageId' | 'guardPost' | 'engineer'>): boolean {
  const retinue = unit.villageId === undefined && unit.guardPost === undefined
    && (unit.kind === 'warrior' || unit.kind === 'spearman' || unit.kind === 'horseman' || unit.kind === 'archer');
  return unit.kind !== 'leader' && !unit.engineer && !retinue && factionRespectsForbidden(state, unit.faction);
}

/** Zones touching at an edge or corner share one marker. Recomputed only on edits. */
export function forbiddenRegions(state: GameState): readonly ForbiddenRegion[] {
  const cache = zoneCache(state);
  if (cache.regions) return cache.regions;
  const remaining = new Set(cache.cells), regions: ForbiddenRegion[] = [];
  while (remaining.size) {
    const first = remaining.values().next().value as number;
    const cells = [first]; remaining.delete(first);
    let sumX = 0, sumY = 0;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i], x = cell % cache.width, y = Math.floor(cell / cache.width);
      sumX += x + .5; sumY += y + .5;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy || x + dx < 0 || y + dy < 0 || x + dx >= cache.width || y + dy >= cache.height) continue;
        const next = (y + dy) * cache.width + x + dx;
        if (remaining.delete(next)) cells.push(next);
      }
    }
    const centroid = { x: sumX / cells.length, y: sumY / cells.length };
    let closest = first, distance = Infinity;
    for (const cell of cells) {
      const d = (cell % cache.width + .5 - centroid.x) ** 2 + (Math.floor(cell / cache.width) + .5 - centroid.y) ** 2;
      if (d < distance || d === distance && cell < closest) { distance = d; closest = cell; }
    }
    const centroidInside = cells.includes(Math.floor(centroid.y) * cache.width + Math.floor(centroid.x));
    regions.push({ id: cells.reduce((minimum, cell) => Math.min(minimum, cell), first), cells,
      center: centroidInside ? centroid : { x: closest % cache.width + .5, y: Math.floor(closest / cache.width) + .5 } });
  }
  cache.regions = regions;
  return regions;
}

/** Rectangle designation is map-wide, free, and independent of fog or borders. */
export function setForbiddenRectangle(state: GameState, start: Point, end: Point, forbidden: boolean): { count: number; message: string } {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return { count: 0, message: 'Choose an area on the map' };
  const { width, height } = state.world;
  const left = Math.max(0, Math.floor(Math.min(start.x, end.x))), right = Math.min(width - 1, Math.floor(Math.max(start.x, end.x)));
  const top = Math.max(0, Math.floor(Math.min(start.y, end.y))), bottom = Math.min(height - 1, Math.floor(Math.max(start.y, end.y)));
  const cells = new Set(forbiddenCells(state));
  let count = 0;
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const cell = y * width + x;
    if (forbidden && !cells.has(cell)) { cells.add(cell); count++; }
    else if (!forbidden && cells.delete(cell)) count++;
  }
  if (count) {
    state.forbiddenZones = { cells: [...cells].sort((a, b) => a - b), revision: forbiddenRevision(state, playerFaction(state)) + 1 };
    if (state.multiplayer) playerControl(state).forbiddenZones = state.forbiddenZones;
    for (const unit of state.units) if ((!state.multiplayer || unit.faction === playerFaction(state)) && unitRespectsForbidden(state, unit)) { unit.path = undefined; unit.repathAt = 0; }
  }
  return { count, message: count ? `${count} tile${count === 1 ? '' : 's'} ${forbidden ? 'forbidden' : 'allowed again'}`
    : forbidden ? 'Area already forbidden' : 'No forbidden tiles in this area' };
}
