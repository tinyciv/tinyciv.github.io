import { playerFaction } from './player-context';
import { isForbidden } from './forbidden-zones';
import { type GameState, type Point, WATER, buildingReady, buildingWidth, buildingHeight, distance, tileAt } from './types';
import { canWalk, findPath, invalidateNavigation } from './pathfinding';
import { terrainYields } from '../world/generator';
import { markWorldChanged } from './world-revisions';
import { vegetationStump } from './vegetation-art';
import { SimulationEvents } from './simulation-events';

export const TREE_CLEAR_SECONDS = 4;
export const TREE_STUMP_SECONDS = 30;
type TreeStump = NonNullable<GameState['treeStumps']>[number];
interface StumpClock {
  world: GameState['world']; time: number; stumps: GameState['treeStumps']; count: number;
  events: SimulationEvents<TreeStump>;
}
const stumpClocks = new WeakMap<GameState, StumpClock>();

/** Cosmetic remains expire on simulation time, so pause also pauses them. */
export function updateTreeStumps(state: GameState): void {
  let clock = stumpClocks.get(state);
  if (!clock || clock.world !== state.world || clock.time > state.time || clock.stumps !== state.treeStumps
    || clock.count !== (state.treeStumps?.length ?? 0)) {
    clock = { world: state.world, time: state.time, stumps: state.treeStumps, count: state.treeStumps?.length ?? 0,
      events: new SimulationEvents() };
    for (const stump of state.treeStumps ?? []) clock.events.schedule(stump, stump.expiresAt, stump);
    stumpClocks.set(state, clock);
  }
  clock.time = state.time;
  if (clock.events.takeDue(state.time).length) {
    state.treeStumps = state.treeStumps!.filter(stump => stump.expiresAt > state.time);
    clock.stumps = state.treeStumps; clock.count = state.treeStumps.length;
  }
}
export function hasTree(state: GameState, point: Point): boolean {
  const tile = tileAt(state.world, point.x, point.y);
  return !!tile && !WATER.has(tile.terrain) && (!!tile.marsh || !!tile.palm || ['forest', 'jungle'].includes(tile.overlay));
}
export function treeWorkEdges(state: GameState, point: Point, faction: number): Point[] {
  return [{ x: point.x - .5, y: point.y + .5 }, { x: point.x + 1.5, y: point.y + .5 },
    { x: point.x + .5, y: point.y - .5 }, { x: point.x + .5, y: point.y + 1.5 }]
    .filter(edge => canWalk(state, edge.x, edge.y, faction, undefined, true));
}
export function validateTreeClearing(state: GameState, x: number, y: number): { ok: boolean; message: string } {
  const point = { x: Math.floor(x), y: Math.floor(y) };
  const marsh = !!tileAt(state.world, point.x, point.y)?.marsh, name = marsh ? 'Marsh plants' : 'Tree';
  const leader = state.units.find(unit => unit.faction === playerFaction(state) && unit.kind === 'leader' && unit.hp > 0);
  if (state.gameOver || !leader) return { ok: false, message: 'This realm can no longer clear trees.' };
  if (distance(leader, { x: point.x + .5, y: point.y + .5 }) > 10) return { ok: false, message: 'Clear trees within 10 tiles of your leader.' };
  // Clearing is a placement order, so fog never blocks marking its footprint.
  // Terrain, Leader range, occupancy and a real worker route still apply.
  if (!hasTree(state, point)) return { ok: false, message: 'Choose a tree or marsh plants.' };
  if (state.treeClearings?.some(order => order.x === point.x && order.y === point.y)) return { ok: false, message: `${name} already marked for clearing.` };
  if (state.buildings.some(building => building.hp > 0 && point.x >= building.x && point.y >= building.y
    && point.x < building.x + buildingWidth(building) && point.y < building.y + buildingHeight(building))) return { ok: false, message: 'Tile occupied.' };
  if (isForbidden(state, point.x, point.y)) return { ok: false, message: 'This area is forbidden.' };
  const edges = treeWorkEdges(state, point, playerFaction(state));
  for (const palace of state.buildings.filter(building => building.kind === 'palace' && building.faction === playerFaction(state) && buildingReady(building))) {
    const exits: Point[] = [];
    for (let i = 0; i < 2; i++) exits.push({ x: palace.x - .5, y: palace.y + i + .5 }, { x: palace.x + 2.5, y: palace.y + i + .5 },
      { x: palace.x + i + .5, y: palace.y - .5 }, { x: palace.x + i + .5, y: palace.y + 2.5 });
    for (const exit of exits.filter(exit => canWalk(state, exit.x, exit.y, playerFaction(state), undefined, true))) for (const edge of edges)
      if (distance(exit, edge) < .12 || findPath(state, exit, edge, playerFaction(state), false, undefined, undefined, undefined, false, true).length) return { ok: true, message: '' };
  }
  return { ok: false, message: `${name} need${marsh ? '' : 's'} a route from the settlement.` };
}
export function orderTreeClearing(state: GameState, x: number, y: number): { ok: boolean; message: string } {
  const validation = validateTreeClearing(state, x, y);
  if (!validation.ok) return validation;
  (state.treeClearings ??= []).push({ x: Math.floor(x), y: Math.floor(y), faction: playerFaction(state) });
  for (const worker of state.units) if (worker.builder && worker.faction === playerFaction(state) && worker.buildPhase === 'idle') worker.repathAt = 0;
  return { ok: true, message: `${tileAt(state.world, x, y)?.marsh ? 'Marsh plants' : 'Tree'} marked for clearing.` };
}
export function fellTree(state: GameState, point: Point): void {
  const tile = tileAt(state.world, point.x, point.y);
  if (tile && hasTree(state, point)) {
    const stump = vegetationStump(tile);
    if (stump) {
      updateTreeStumps(state);
      state.treeStumps = (state.treeStumps ?? []).filter(old => old.x !== point.x || old.y !== point.y);
      state.treeStumps.push({ x: Math.floor(point.x), y: Math.floor(point.y), sourceX: stump.x, sourceY: stump.y, expiresAt: state.time + TREE_STUMP_SECONDS });
    }
    const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields(tile.terrain, 'none');
    tile.overlay = 'none';
    delete tile.palm;
    // Clearing foliage leaves the wetland soil and delta geography intact.
    delete tile.marsh;
    for (const resource of ['food', 'production', 'gold'] as const) tile[resource] = Math.max(0, tile[resource] - before[resource] + after[resource]);
    markWorldChanged(state.world, 'sight');
    invalidateNavigation(state);
  }
  state.treeClearings = state.treeClearings?.filter(order => order.x !== point.x || order.y !== point.y);
}
