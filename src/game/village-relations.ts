import type { NeutralVillage, VillageRelation } from './types';
export const villageAlly = (village: NeutralVillage): number | undefined => village.alliedFaction !== undefined && village.alliedFaction !== 0 ? village.alliedFaction : village.relation === 'allied' ? 0 : undefined;
export const villageAlliedWith = (village: NeutralVillage, faction: number): boolean => !village.destroyed && villageAlly(village) === faction;
export function villageRelation(village: NeutralVillage, faction: number): VillageRelation {
  if (faction === 0) return village.relation;
  return village.relationsByFaction?.[faction] ?? (villageAlly(village) === faction ? 'allied'
    : faction === 0 ? village.relation : village.tradingFactions?.includes(faction) ? 'trade' : 'neutral');
}
