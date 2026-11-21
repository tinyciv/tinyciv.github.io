import { placementOccupancy } from './placement-occupancy';
import { terrainNavigationEdges, traversable } from './pathfinding';
import { factionRespectsForbidden, forbiddenCells } from './forbidden-zones';
import { territoryValue } from './territory-cells';
import type { Territory } from './borders';
import { reliefFootprintAllowed } from './relief';
import { buildingReady, isWallKind, tileAt, WATER, type Building, type GameState, type Point } from './types';
import { simCore } from './sim-handle';
import { rustEngine } from './rust-engine';

// Keep the observation window and flags in sync with sim/city_planning.rs.
const radius = 7, span = radius * 2 + 1;
const ROAD = 1, READY = 2, BUILDABLE = 4, OPEN = 8;

/** Sample occupancy only around a new house, including queued footprints.
 * The native planner selects the street; farms and other claims stay intact. */
export function planTownStreet(state: GameState, palace: Building, house: Point, borders: Territory,
  { maxTiles = 4, canBuild }: { maxTiles?: number; canBuild?: (point: Point) => boolean } = {}): Point[] {
  const world = state.world, occupancy = placementOccupancy(state), edges = terrainNavigationEdges(world);
  const forbidden = factionRespectsForbidden(state, palace.faction) ? forbiddenCells(state, palace.faction) : undefined;
  const observations = new Uint8Array(span * span * 2);
  const indexAt = (dx: number, dy: number): number => ((dy + radius) * span + dx + radius) * 2;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if (!dx && !dy) continue;
    const x = house.x + dx, y = house.y + dy, tile = tileAt(world, x, y);
    if (!tile) continue;
    const index = indexAt(dx, dy), cell = y * world.width + x, owner = territoryValue(borders, cell);
    const structures = occupancy.at(x, y);
    const route = structures.find(b => b.hp > 0 && (b.kind === 'road' || b.kind === 'bridge'));
    // Nearby routes still constrain junction placement on unsuitable cells.
    if (route) observations[index] = ROAD;
    if (WATER.has(tile.terrain) || !traversable(world, x, y) || forbidden?.has(cell)) continue;
    if (owner >= 0 && owner !== palace.faction) continue;
    if (structures.some(b => (b.hp > 0 || b.fort?.destroyed) && b !== route
      && !(b.kind === 'irrigation' && b.faction === palace.faction
        || route?.kind === 'road' && isWallKind(b.kind) && (b.faction === palace.faction || b.faction === -1)))) continue;
    observations[index + 1] = edges[cell];
    if (route) {
      if (route.faction === palace.faction && buildingReady(route)) observations[index] |= READY | OPEN;
    } else if (tile.farm === undefined) {
      observations[index] = OPEN;
      if (reliefFootprintAllowed(world, x, y)) observations[index] |= BUILDABLE;
    }
  }
  const handle = simCore(state).handle;
  // A local placement rule can reject the best spur. Give the planner a
  // bounded chance to select a different route around each rejected tile.
  for (let attempt = 0; attempt < 3; attempt++) {
    const input = rustEngine.sim_city_planning_input(handle, observations.length);
    new Uint8Array(rustEngine.memory.buffer, input, observations.length).set(observations);
    const output = rustEngine.sim_city_street(handle, palace.x - house.x, palace.y - house.y);
    const [count, startX, startY, dx, dy] = new Int32Array(rustEngine.memory.buffer, output, 5);
    if (!count) break;
    const street = Array.from({ length: Math.min(count, maxTiles) }, (_, step) => ({
      x: house.x + startX + dx * step, y: house.y + startY + dy * step,
    }));
    const blocked = canBuild && street.find(point => !canBuild(point));
    if (!blocked) return street;
    observations[indexAt(blocked.x - house.x, blocked.y - house.y)] &= ~BUILDABLE;
  }
  return [];
}
