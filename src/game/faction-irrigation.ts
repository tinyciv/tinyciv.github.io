import { IRRIGATION_RADIUS, IRRIGATION_OFFSETS, isFreshwaterSource, irrigationYieldMultiplier } from './irrigation';
import { cityOwnership } from './city-ownership';
import { buildingHeight, buildingWidth, isFarmKind, tileAt, WATER, type Building, type GameState, type Point } from './types';

/** Reserve new ditches for dense patches of at least six farm plots.
 * Native freshwater/ditch connectivity remains authoritative. */
export function factionIrrigationSites(state: GameState, palace: Building): Point[] {
  const ownership = cityOwnership(state);
  const ditches = state.buildings.filter(b => b.hp > 0 && b.kind === 'irrigation');
  const ditchCells = new Set(ditches.map(ditch => ditch.y * state.world.width + ditch.x)), occupied = new Set<number>();
  for (const building of state.buildings) if (building.hp > 0)
    for (let y = building.y; y < building.y + buildingHeight(building); y++)
      for (let x = building.x; x < building.x + buildingWidth(building); x++) occupied.add(y * state.world.width + x);
  const farms = state.buildings.filter(b => b.faction === palace.faction && b.hp > 0 && isFarmKind(b.kind) && !b.orchard
    && ownership.nearest({ x: b.x + .5, y: b.y + .5 }, b.faction)?.id === palace.id
    && irrigationYieldMultiplier(state, b.x, b.y) === 1
    && !ditches.some(ditch => (ditch.x - b.x) ** 2 + (ditch.y - b.y) ** 2 <= IRRIGATION_RADIUS ** 2));
  const candidates = new Map<number, { x: number; y: number; coverage: number }>();
  for (const farm of farms) for (const [dx, dy] of IRRIGATION_OFFSETS) {
    const x = farm.x + dx, y = farm.y + dy, tile = tileAt(state.world, x, y);
    if (!tile || WATER.has(tile.terrain) || tile.ridge && !tile.stair) continue;
    const key = y * state.world.width + x, candidate = candidates.get(key);
    if (candidate) candidate.coverage++;
    else candidates.set(key, { x, y, coverage: 1 });
  }
  return [...candidates.values()].filter(candidate => candidate.coverage >= 6 && !occupied.has(candidate.y * state.world.width + candidate.x)
    && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => isFreshwaterSource(state, candidate.x + dx, candidate.y + dy)
      || !!tileAt(state.world, candidate.x + dx, candidate.y + dy) && ditchCells.has((candidate.y + dy) * state.world.width + candidate.x + dx)))
    .sort((a, b) => b.coverage - a.coverage || Math.hypot(a.x - palace.x, a.y - palace.y) - Math.hypot(b.x - palace.x, b.y - palace.y));
}
