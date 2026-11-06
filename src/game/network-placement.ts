import { playerFaction } from './player-context';
import { type Building, type BuildingKind, type GameState, isWallKind } from './types';

const cardinal = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;
const isRoute = (kind: BuildingKind): boolean => kind === 'road' || kind === 'bridge';
export const MIN_GATE_SPACING = 2;
export const MIN_ROAD_JUNCTION_SPACING = 2;
export interface NetworkPlacement { ok: boolean; message: string }
const allowed: NetworkPlacement = { ok: true, message: '' };

/** A road may open an existing friendly or unclaimed wall without first
 * connecting to a road network. Orders reserve this gateway immediately. */
export function hasGateWall(state: GameState, x: number, y: number, faction = playerFaction(state)): boolean {
  x = Math.floor(x); y = Math.floor(y);
  return state.buildings.some(building => building.hp > 0 && isWallKind(building.kind)
    && (building.faction === faction || building.faction === -1) && building.x === x && building.y === y);
}

/** One immutable topology for a synchronous route search. Each candidate may
 * add its own short reserved path without rebuilding the entire world's roads.
 * Live entry points create a new query, so same-tick deaths/ownership stay live. */
export function createNetworkPlacementQuery(state: GameState) {
  const width = state.world.width, height = state.world.height;
  const routes = new Set<number>(), roads = new Set<number>(), walls = new Set<number>(), owners = new Map<number, Set<number>>();
  for (const building of state.buildings) if (building.hp > 0) {
    const at = building.y * width + building.x;
    if (isRoute(building.kind)) routes.add(at);
    if (building.kind === 'road') roads.add(at);
    if (isWallKind(building.kind)) {
      walls.add(at); const factions = owners.get(at) ?? new Set<number>(); factions.add(building.faction); owners.set(at, factions);
    }
  }
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const neighbors = (index: number): number[] => {
    const x = index % width, y = Math.floor(index / width);
    return cardinal.filter(([dx, dy]) => inside(x + dx, y + dy)).map(([dx, dy]) => (y + dy) * width + x + dx);
  };
  return (kind: BuildingKind, x: number, y: number, faction = playerFaction(state), additions: readonly Building[] = []): NetworkPlacement => {
    if (!isRoute(kind) && !isWallKind(kind)) return allowed;
    x = Math.floor(x); y = Math.floor(y);
    const index = y * width + x, addedRoutes = new Set<number>(), addedRoads = new Set<number>(), addedWalls = new Set<number>();
    for (const building of additions) if (building.hp > 0) {
      const at = building.y * width + building.x;
      if (isRoute(building.kind)) addedRoutes.add(at);
      if (building.kind === 'road') addedRoads.add(at);
      if (isWallKind(building.kind)) addedWalls.add(at);
    }
    const openingGate = kind === 'road' && (owners.get(index)?.has(faction) || owners.get(index)?.has(-1)
      || additions.some(building => building.hp > 0 && isWallKind(building.kind) && building.x === x && building.y === y
        && (building.faction === faction || building.faction === -1)));
    const addsWall = isWallKind(kind) && !walls.has(index) && !addedWalls.has(index);
    if (isRoute(kind)) addedRoutes.add(index);
    if (kind === 'road') addedRoads.add(index);
    if (isWallKind(kind)) addedWalls.add(index);
    const routeAt = (at: number) => routes.has(at) || addedRoutes.has(at);
    const wallAt = (at: number) => walls.has(at) || addedWalls.has(at);
    const gateAt = (at: number) => wallAt(at) && (roads.has(at) || addedRoads.has(at));

    if (isWallKind(kind)) {
      if (addsWall) for (const changed of [index, ...neighbors(index)]) if (wallAt(changed)
        && neighbors(changed).filter(wallAt).length > 3)
          return { ok: false, message: 'Walls may form lines, corners or T junctions, but not four-way crosses.' };
      for (const oy of [-1, 0]) for (const ox of [-1, 0]) {
        const left = x + ox, top = y + oy;
        if (inside(left, top) && inside(left + 1, top + 1)
          && [0, 1].every(dy => [0, 1].every(dx => wallAt((top + dy) * width + left + dx))))
          return { ok: false, message: 'Walls must remain lines or junctions; leave an opening in a 2×2 block.' };
      }
    }
    if (isRoute(kind) && !openingGate) {
      for (const oy of [-1, 0]) for (const ox of [-1, 0]) {
        const left = x + ox, top = y + oy;
        if (inside(left, top) && inside(left + 1, top + 1)
          && [0, 1].every(dy => [0, 1].every(dx => routeAt((top + dy) * width + left + dx))))
          return { ok: false, message: 'Roads must remain lines or junctions.' };
      }
      const junctionAt = (at: number) => routeAt(at) && neighbors(at).filter(routeAt).length >= 3;
      for (const changed of [index, ...neighbors(index)]) if (junctionAt(changed)) {
        const cx = changed % width, cy = Math.floor(changed / width), radius = Math.ceil(MIN_ROAD_JUNCTION_SPACING);
        // Only junctions within the spacing radius can invalidate this cell.
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++)
          if ((dx || dy) && Math.hypot(dx, dy) < MIN_ROAD_JUNCTION_SPACING && inside(cx + dx, cy + dy)
            && junctionAt((cy + dy) * width + cx + dx))
            return { ok: false, message: `Keep road junctions at least ${MIN_ROAD_JUNCTION_SPACING} tiles apart.` };
      }
    }
    const gates: number[] = [], radius = MIN_GATE_SPACING;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++)
      if (inside(x + dx, y + dy) && gateAt((y + dy) * width + x + dx)) gates.push((y + dy) * width + x + dx);
    if (gateAt(index)) for (const gate of gates) if (gate !== index) {
      const dx = Math.abs(gate % width - x), dy = Math.abs(Math.floor(gate / width) - y);
      if (dx + dy < MIN_GATE_SPACING || dx <= 1 && dy <= 1)
        return { ok: false, message: 'Leave one wall tile between gates; gates cannot touch.' };
    }
    for (const gate of gates) {
      const queue = [{ at: gate, steps: 0, changed: gate === index }], visited = new Set([gate]);
      for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        if (current.steps >= MIN_GATE_SPACING - 1) continue;
        for (const next of neighbors(current.at)) if (wallAt(next) && !visited.has(next)) {
          const changed = current.changed || next === index;
          if (gateAt(next) && changed) return { ok: false, message: 'Leave one wall tile between gates; gates cannot touch.' };
          visited.add(next); queue.push({ at: next, steps: current.steps + 1, changed });
        }
      }
    }
    return allowed;
  };
}

/** All living orders reserve network spacing, including paused construction. */
export function validateNetworkPlacement(state: GameState, kind: BuildingKind, x: number, y: number, faction = playerFaction(state)): NetworkPlacement {
  if (!isRoute(kind) && !isWallKind(kind)) return allowed;
  return createNetworkPlacementQuery(state)(kind, x, y, faction);
}
