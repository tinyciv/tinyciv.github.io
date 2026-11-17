import { territoryValue } from './territory-cells';
import { territory, UNCLAIMED } from './borders';
import type { BuildingKind, GameState } from './types';
import { worldChangesSince } from './world-revisions';

interface StoneCells {
  tiles: GameState['world']['tiles']; cursor?: number; revision: number; cells: Set<number>;
}
const deposits = new WeakMap<GameState['world'], StoneCells>();
const cache = new WeakMap<GameState, { world: GameState['world']; tiles: GameState['world']['tiles']; revision: number; borders: number; counts: Map<number, number> }>();
function stoneCells(world: GameState['world']): StoneCells {
  let index = deposits.get(world);
  if (!index || index.tiles !== world.tiles) {
    index = { tiles: world.tiles, revision: 0, cells: new Set() }; deposits.set(world, index);
  }
  const changes = worldChangesSince(world, index.cursor);
  const reconcile = (cell: number) => {
    const stone = world.tiles[cell].resource === 'stone';
    if (stone === index.cells.has(cell)) return;
    if (stone) index.cells.add(cell); else index.cells.delete(cell);
    index.revision++;
  };
  if (changes.full) for (let cell = 0; cell < world.tiles.length; cell++) reconcile(cell);
  else for (const cell of changes.cells) reconcile(cell);
  index.cursor = changes.revision;
  return index;
}

export function controlledStoneTiles(state: GameState, faction: number): number {
  const borders = territory(state), stones = stoneCells(state.world), old = cache.get(state);
  if (old?.world === state.world && old.tiles === state.world.tiles && old.revision === stones.revision && old.borders === borders.revision)
    return old.counts.get(faction) ?? 0;
  const counts = new Map<number, number>();
  for (const i of stones.cells) if (territoryValue(borders, i) !== UNCLAIMED)
    counts.set(territoryValue(borders, i), (counts.get(territoryValue(borders, i)) ?? 0) + 1);
  cache.set(state, { world: state.world, tiles: state.world.tiles, revision: stones.revision, borders: borders.revision, counts });
  return counts.get(faction) ?? 0;
}
export function stoneDefenseMultiplier(state: GameState, faction: number, kind: BuildingKind): number {
  return ['wall', 'woodenTower', 'tower'].includes(kind) ? 1 - Math.min(.75, controlledStoneTiles(state, faction) * .05) : 1;
}
