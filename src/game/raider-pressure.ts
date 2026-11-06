import type { GameState } from './types';

export const RAIDER_EQUIPMENT_RAMP_SECONDS = 15 * 60;
export const RAIDER_MAX_EQUIPMENT_MULTIPLIER = 1.6;
export const RAIDER_OPENING_WAVE_INTERVAL = 26;
export const RAIDER_MIN_WAVE_INTERVAL = 14;
/** One offensive reduction for every raider source; population and cadence
 * remain independent. Applied after armor so minimum hits also fall by 15%. */
export const RAIDER_ATTACK_MULTIPLIER = .85;

/** Halve the shortfall relative to an untrained faction warrior. The existing
 * raider damage factor is included so the attack gap is halved after it too. */
export function marauderBaseStats(hp: number, attack: number, defense: number): { hp: number; attack: number; defense: number } {
  return { hp: (hp + 100) / 2, attack: (attack + 17 / RAIDER_ATTACK_MULTIPLIER) / 2, defense: (defense + 4) / 2 };
}

function pressureProgress(elapsedSeconds: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0) / RAIDER_EQUIPMENT_RAMP_SECONDS);
}

/** Independent time-based pressure; blacksmith balance does not change raids. */
export function raiderEquipmentMultiplier(elapsedSeconds: number): number {
  return 1 + (RAIDER_MAX_EQUIPMENT_MULTIPLIER - 1) * pressureProgress(elapsedSeconds);
}

/** Base cadence before Bandit intensity; elapsed time never raises population caps. */
export function raiderWaveInterval(elapsedSeconds: number): number {
  return RAIDER_OPENING_WAVE_INTERVAL - (RAIDER_OPENING_WAVE_INTERVAL - RAIDER_MIN_WAVE_INTERVAL) * pressureProgress(elapsedSeconds);
}

/** Store a factor, never mutate base stats: survivors and fresh recruits share
 * the same date-based equipment and repeated updates cannot compound it. */
export function updateRaiderEquipment(state: Pick<GameState, 'time' | 'units'>): void {
  const multiplier = raiderEquipmentMultiplier(state.time);
  for (const unit of state.units) if (unit.faction === -2 && unit.hp > 0)
    unit.raiderEquipmentMultiplier = multiplier;
}
