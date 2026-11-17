import { BUILDING_ACTIVITY_RANGE } from './building-activity';
import { pointInSight, type FogView } from './fog';
import { playerFaction } from './player-context';
import { resourceCityAt } from './resource-development';
import { indexedLeader } from './spatial';
import type { GameState } from './types';
import type { ResourceCellArt } from './resource-art';

export interface ResourceInteractionPatch {
  x: number; y: number;
  cells: readonly { x: number; y: number; art: ResourceCellArt }[];
}
const patchCache = new WeakMap<ReadonlyMap<number, ResourceCellArt>, { explored: number; patches: ReadonlyMap<number, ResourceInteractionPatch> }>();

/** Group observed art once per layout/exploration revision, never per frame. */
export function resourceInteractionPatches(state: GameState, resources: ReadonlyMap<number, ResourceCellArt>, fog: FogView): ReadonlyMap<number, ResourceInteractionPatch> {
  const previous = patchCache.get(resources);
  if (previous?.explored === fog.explorationRevision) return previous.patches;
  const { width, height, tiles } = state.world, patches = new Map<number, ResourceInteractionPatch>();
  for (const [start, art] of resources) {
    if (patches.has(start) || !fog.explored[start]) continue;
    const cells: { x: number; y: number; art: ResourceCellArt }[] = [];
    const patch: ResourceInteractionPatch = { x: width, y: height, cells }, queue = [start];
    patches.set(start, patch);
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head], x = cell % width, y = Math.floor(cell / width);
      patch.x = Math.min(patch.x, x); patch.y = Math.min(patch.y, y);
      cells.push({ x, y, art: resources.get(cell)! });
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || patches.has(next) || !fog.explored[next]
          || resources.get(next)?.resource !== art.resource || tiles[next].resourceGroup !== tiles[start].resourceGroup) continue;
        patches.set(next, patch); queue.push(next);
      }
    }
  }
  patchCache.set(resources, { explored: fog.explorationRevision, patches });
  return patches;
}

/** Match building interaction reach without scanning units or deposits per frame. */
export function resourceInteractionColor(state: GameState, x: number, y: number, fog: FogView): string | undefined {
  if (state.gameOver || !pointInSight(fog, x + .5, y + .5)) return;
  const faction = playerFaction(state), leader = indexedLeader(state, faction);
  if (!leader || leader.inside) return;
  const dx = Math.max(x - leader.x, 0, leader.x - x - 1), dy = Math.max(y - leader.y, 0, leader.y - y - 1);
  if (dx * dx + dy * dy > BUILDING_ACTIVITY_RANGE ** 2) return;
  if (resourceCityAt(state, x, y)?.faction !== faction) return;
  return state.factions.find(owner => owner.id === faction)?.color;
}
