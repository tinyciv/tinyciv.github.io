import type { Faction, ResearchBranchId } from '../../src/game/types';

/** Unlock construction/recruitment without enabling unrelated statistical
 * bonuses in base economy and combat fixtures. */
export function unlockBuildingResearch(faction: Pick<Faction, 'research'>): void {
  const branches: ResearchBranchId[] = ['wall', 'woodenTower', 'monument', 'blacksmith', 'archeryRange', 'irrigation', 'scoutLodge'];
  faction.research = {
    focus: 'wall',
    levels: Object.fromEntries(branches.map(branch => [branch, 1])),
    progress: {},
  };
}
