import { rustEngine } from './rust-engine';
import type { Faction } from './types';
/** Permanent reward mirrors; the native rules own every amount and multiplier. */
export const questEffect = (faction: Pick<Faction, 'questBenefits'> | undefined, effect: number, value: number): number => rustEngine.quest_effect(faction?.questBenefits ?? 0, effect, value);
