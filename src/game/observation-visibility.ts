import type { Unit } from './types';

/** Concealment is authoritative: sight coverage alone never reveals a lookout. */
export function observationPostVisibleTo(unit: Pick<Unit, 'faction' | 'observationPost'>, faction: number): boolean {
  const post = unit.observationPost;
  return !post || post.retreating === true || unit.faction === faction || post.discoveredBy.includes(faction);
}

/** Shared by full snapshots and incremental multiplayer frames. Hidden lookouts
 * never enter an opponent's serialized state, even when their tile is lit. */
export function observationUnitsForViewer(units: readonly Unit[], faction: number): Unit[] {
  return units.filter(unit => observationPostVisibleTo(unit, faction));
}
