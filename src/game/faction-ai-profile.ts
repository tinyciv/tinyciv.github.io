import type { GameState } from './types';

/** Explicit, deterministic policy controls for the headless AI tournament. */
export type FactionAIProfile = 'legacy' | 'aggressive' | 'coordinated';
export const FACTION_AI_PROFILES: readonly FactionAIProfile[] = ['legacy', 'aggressive', 'coordinated'];
export const DEFAULT_FACTION_AI_PROFILE: FactionAIProfile = 'coordinated';
const profiles = new WeakMap<GameState, Map<number, FactionAIProfile>>();
export function setFactionAIProfile(state: GameState, faction: number, profile: FactionAIProfile): void {
  let chosen = profiles.get(state);
  if (!chosen) { chosen = new Map(); profiles.set(state, chosen); }
  chosen.set(faction, profile);
}
export function factionAIProfile(state: GameState, faction: number): FactionAIProfile {
  return profiles.get(state)?.get(faction) ?? DEFAULT_FACTION_AI_PROFILE;
}
