import { buildingReady, type GameState, type Point, type Unit } from './types';
import { entityStore } from './entity-store';

export const HEALER_SHACK_RADIUS = 4;
export const HEALER_SHACK_MULTIPLIER = 3;
export const HEALER_SHACK_COST = 200;
export const HEALER_SHACK_BUILD_SECONDS = 45;
export const HEALER_SHACK_HP = 160;

const isHuman = (unit: Unit): boolean => unit.kind === 'leader' || unit.kind === 'warrior' || unit.kind === 'spearman' || unit.kind === 'horseman' || unit.kind === 'archer'
  || unit.kind === 'scout' || unit.kind === 'militia' || unit.kind === 'worker' || unit.kind === 'merchant';

/** Build once for a healing pass. Four-tile buckets limit each wounded unit
 * to nearby shacks, regardless of the number of farms or other structures.
 * Ownership, completion and destruction are read anew on the next pass. */
export function healerShackHealingQuery(state: GameState): (unit: Unit) => number {
  const columns = Math.ceil(state.world.width / HEALER_SHACK_RADIUS);
  const rows = Math.ceil(state.world.height / HEALER_SHACK_RADIUS);
  const factions = new Map<number, Map<number, Point[]>>();
  for (const building of entityStore(state).buildings.query('healerShack')) {
    if (building.faction < 0 || !buildingReady(building)) continue;
    const point = { x: building.x + .5, y: building.y + .5 };
    const key = Math.floor(point.y / HEALER_SHACK_RADIUS) * columns + Math.floor(point.x / HEALER_SHACK_RADIUS);
    let buckets = factions.get(building.faction);
    if (!buckets) { buckets = new Map(); factions.set(building.faction, buckets); }
    const group = buckets.get(key);
    if (group) group.push(point); else buckets.set(key, [point]);
  }
  return unit => {
    if (!isHuman(unit)) return 1;
    const buckets = factions.get(unit.faction);
    if (!buckets) return 1;
    const column = Math.floor(unit.x / HEALER_SHACK_RADIUS), row = Math.floor(unit.y / HEALER_SHACK_RADIUS);
    for (let y = Math.max(0, row - 1); y <= Math.min(rows - 1, row + 1); y++)
      for (let x = Math.max(0, column - 1); x <= Math.min(columns - 1, column + 1); x++)
        for (const point of buckets.get(y * columns + x) ?? [])
          if ((unit.x - point.x) ** 2 + (unit.y - point.y) ** 2 <= HEALER_SHACK_RADIUS ** 2) return HEALER_SHACK_MULTIPLIER;
    return 1;
  };
}
