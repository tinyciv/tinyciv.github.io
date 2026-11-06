import { playerFaction } from './player-context';
import { type BuildingKind, type GameState, isWallKind } from './types';

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

/** All living orders reserve network spacing immediately, including paused
 * construction. Opening an existing wall is exempt from road layout rules;
 * all gates still obey the normal spacing. */
export function validateNetworkPlacement(state: GameState, kind: BuildingKind, x: number, y: number, faction = playerFaction(state)): NetworkPlacement {
  if (!isRoute(kind) && !isWallKind(kind)) return allowed;
  x = Math.floor(x); y = Math.floor(y);
  const openingGate = kind === 'road' && hasGateWall(state, x, y, faction);
  const width = state.world.width, height = state.world.height, index = y * width + x;
  const cell = (x: number, y: number): number => y * width + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const neighbors = (index: number): number[] => {
    const x = index % width, y = Math.floor(index / width);
    return cardinal.filter(([dx, dy]) => inside(x + dx, y + dy)).map(([dx, dy]) => cell(x + dx, y + dy));
  };
  const routes = new Set<number>(), roads = new Set<number>(), walls = new Set<number>();
  for (const building of state.buildings) if (building.hp > 0) {
    const at = cell(building.x, building.y);
    if (isRoute(building.kind)) routes.add(at);
    if (building.kind === 'road') roads.add(at);
    if (isWallKind(building.kind)) walls.add(at);
  }
  const addsWall = isWallKind(kind) && !walls.has(index);
  if (isRoute(kind)) routes.add(index);
  if (kind === 'road') roads.add(index);
  if (isWallKind(kind)) walls.add(index);

  if (isWallKind(kind)) {
    // Adding an arm may turn a neighboring T into a cross even if the new
    // cell itself has only one connection. Existing layers keep their topology.
    if (addsWall) for (const changed of [index, ...neighbors(index)]) if (walls.has(changed)
      && neighbors(changed).filter(next => walls.has(next)).length > 3)
      return { ok: false, message: 'Walls may form lines, corners or T junctions, but not four-way crosses.' };
    for (const oy of [-1, 0]) for (const ox of [-1, 0]) {
      const left = x + ox, top = y + oy;
      if (inside(left, top) && inside(left + 1, top + 1)
        && [0, 1].every(dy => [0, 1].every(dx => walls.has(cell(left + dx, top + dy)))))
        return { ok: false, message: 'Walls must remain lines or junctions; leave an opening in a 2×2 block.' };
    }
  }

  if (isRoute(kind) && !openingGate) {
    for (const oy of [-1, 0]) for (const ox of [-1, 0]) {
      const left = x + ox, top = y + oy;
      if (inside(left, top) && inside(left + 1, top + 1)
        && [0, 1].every(dy => [0, 1].every(dx => routes.has(cell(left + dx, top + dy)))))
        return { ok: false, message: 'Roads must remain lines or junctions.' };
    }
    const junctions = new Set([...routes].filter(at => neighbors(at).filter(next => routes.has(next)).length >= 3));
    // Adding one cell can turn its neighbors into junctions as well. Checking
    // only the purchased cell would allow tightly packed parallel T junctions.
    for (const changed of [index, ...neighbors(index)]) if (junctions.has(changed)) {
      const cx = changed % width, cy = Math.floor(changed / width);
      for (const other of junctions) if (other !== changed
        && Math.hypot(other % width - cx, Math.floor(other / width) - cy) < MIN_ROAD_JUNCTION_SPACING)
        return { ok: false, message: `Keep road junctions at least ${MIN_ROAD_JUNCTION_SPACING} tiles apart.` };
    }
  }

  const gates = new Set([...walls].filter(at => roads.has(at)));
  if (gates.has(index)) {
    // Diagonally touching openings still look like a double gate, even when
    // their wall segments do not touch cardinally.
    for (const gate of gates) if (gate !== index) {
      const dx = Math.abs(gate % width - x), dy = Math.abs(Math.floor(gate / width) - y);
      if (dx + dy < MIN_GATE_SPACING || dx <= 1 && dy <= 1)
        return { ok: false, message: 'Leave one wall tile between gates; gates cannot touch.' };
    }
  }
  // Check the short wall routes through the changed cell too: inserting a wall
  // between two existing gates must not evade the spacing rule.
  for (const gate of gates) {
    const queue = [{ at: gate, steps: 0, changed: gate === index }], visited = new Set([gate]);
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      if (current.steps >= MIN_GATE_SPACING - 1) continue;
      for (const next of neighbors(current.at)) if (walls.has(next) && !visited.has(next)) {
        const changed = current.changed || next === index;
        if (gates.has(next) && changed)
          return { ok: false, message: 'Leave one wall tile between gates; gates cannot touch.' };
        visited.add(next); queue.push({ at: next, steps: current.steps + 1, changed });
      }
    }
  }
  return allowed;
}
