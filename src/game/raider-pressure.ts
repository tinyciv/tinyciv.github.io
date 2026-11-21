import { rustEngine } from './rust-engine';

/** One offensive reduction for every raider source. Applied after armor so
 * minimum hits also fall by 15%. Raid timing, size and equipment belong to the
 * raid director (raid-director.ts). */
export const RAIDER_ATTACK_MULTIPLIER = rustEngine.combat_constant(15);
export const EARLY_RAID_SIZE_MULTIPLIER = .6;
export const EARLY_RAID_SECONDS = 5 * 60;
export const FULL_RAID_SIZE_SECONDS = 15 * 60;

/** Smaller camp defender sorties early on; director raids size themselves by era. */
export function raiderPartySizeMultiplier(elapsedSeconds: number): number {
  const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
  const ramp = Math.max(0, Math.min(1, (elapsed - EARLY_RAID_SECONDS) / (FULL_RAID_SIZE_SECONDS - EARLY_RAID_SECONDS)));
  return EARLY_RAID_SIZE_MULTIPLIER + (1 - EARLY_RAID_SIZE_MULTIPLIER) * ramp;
}
export function raiderPartySize(count: number, elapsedSeconds: number): number {
  return count > 0 ? Math.max(1, Math.round(count * raiderPartySizeMultiplier(elapsedSeconds))) : 0;
}

/** Halve the shortfall relative to an untrained faction warrior. The existing
 * raider damage factor is included so the attack gap is halved after it too. */
export function marauderBaseStats(hp: number, attack: number, defense: number): { hp: number; attack: number; defense: number } {
  return { hp: (hp + 100) / 2, attack: (attack + 17 / RAIDER_ATTACK_MULTIPLIER) / 2, defense: (defense + 4) / 2 };
}
