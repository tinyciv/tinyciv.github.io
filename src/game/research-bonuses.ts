import type { Faction, ResearchBranchId } from './types';

type ResearchFaction = Pick<Faction, 'research' | 'villageBonuses'> | undefined;
const learned = (faction: ResearchFaction, branch: ResearchBranchId): boolean => (faction?.research?.levels[branch] ?? 0) >= 1;

export const defenseHealthMultiplier = (faction: ResearchFaction): number => learned(faction, 'reinforcedDefenses') ? 1.3 : 1;
export const tradeGoldMultiplier = (faction: ResearchFaction): number => (learned(faction, 'coinage') ? 1.2 : 1) * (1 + (faction?.villageBonuses?.trade ?? 0));
export const housingResearchBonus = (faction: ResearchFaction): number => learned(faction, 'urbanPlanning') ? 1 : 0;
export const constructionSpeedMultiplier = (faction: ResearchFaction): number => (learned(faction, 'metalTools') ? 1.25 : 1) * (1 + (faction?.villageBonuses?.construction ?? 0));
export const archerDamageMultiplier = (faction: ResearchFaction): number => learned(faction, 'fletching') ? 1.15 : 1;
export const grainStorageMultiplier = (faction: ResearchFaction): number => learned(faction, 'grainStorage') ? 1.5 : 1;
