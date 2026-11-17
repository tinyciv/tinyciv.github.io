import { rustEngine } from './rust-engine';
import type { Faction } from './types';

export const AchievementEffect = {
  growth: 4, construction: 5, tax: 6, domesticTrade: 7, culture: 8, orchard: 9,
  homelandDamage: 10, governance: 11, threat: 12, needsTerritory: 13,
} as const;

/** Saved host mirrors are transported to native rules; no gameplay decisions here. */
export const lifetimeCulture = (faction: Pick<Faction, 'culture' | 'cultureSpent'> | undefined): number =>
  rustEngine.culture_earned(faction?.culture ?? 0, faction?.cultureSpent ?? 0);
export const achievementEffect = (faction: Pick<Faction, 'achievements'> | undefined, effect: number, value: number, context = 0): number =>
  rustEngine.achievement_effect(faction?.achievements ?? 0, effect, value, context);
