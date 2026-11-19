import type { Faction, ResearchBranchId } from './types';
import { questEffect } from './quest-effects';
import { AchievementEffect, achievementEffect } from './achievement-effects';
import { rustEngine } from './rust-engine';

type ResearchFaction = Pick<Faction, 'research' | 'villageBonuses' | 'questBenefits' | 'achievements'> | undefined;
const learned = (faction: ResearchFaction, branch: ResearchBranchId): boolean => (faction?.research?.levels[branch] ?? 0) >= 1;

export const defenseHealthMultiplier = (faction: ResearchFaction): number => questEffect(faction, 4, learned(faction, 'reinforcedDefenses') ? 1.3 : 1);
export const tradeGoldMultiplier = (faction: ResearchFaction): number => questEffect(faction, 3, (learned(faction, 'coinage') ? 1.2 : 1) * (1 + (faction?.villageBonuses?.trade ?? 0)));
export const housingResearchBonus = (faction: ResearchFaction): number => questEffect(faction, 5, learned(faction, 'urbanPlanning') ? 1 : 0);
export const constructionSpeedMultiplier = (faction: ResearchFaction): number => achievementEffect(faction, AchievementEffect.construction,
  questEffect(faction, 1, (learned(faction, 'metalTools') ? 1.25 : 1) * (1 + (faction?.villageBonuses?.construction ?? 0))));
export const archerDamageMultiplier = (faction: ResearchFaction): number => learned(faction, 'fletching') ? 1.15 : 1;
export const grainStorageMultiplier = (faction: ResearchFaction): number => learned(faction, 'grainStorage') ? 1.5 : 1;

const farmYieldMultipliers = [
  rustEngine.research_farm_yield_multiplier(0, 0),
  rustEngine.research_farm_yield_multiplier(1, 0),
  rustEngine.research_farm_yield_multiplier(0, 1),
  rustEngine.research_farm_yield_multiplier(1, 1),
];
export function farmResearchYieldMultiplier(faction: ResearchFaction): number {
  const rotation = Number(learned(faction, 'cropRotation'));
  const plows = Number(learned(faction, 'ironPlows'));
  return farmYieldMultipliers[rotation + 2 * plows];
}
