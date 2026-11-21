import type { GameState } from './types';
import { rustEngine } from './rust-engine';

export const DEFAULT_BANDIT_INTENSITY = 1;
export const MIN_BANDIT_INTENSITY = 0;
export const MAX_BANDIT_INTENSITY = 3;

type BanditSettings = Pick<GameState, 'banditIntensity'>;

export function normalizeBanditIntensity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_BANDIT_INTENSITY, Math.min(MAX_BANDIT_INTENSITY, value)) : DEFAULT_BANDIT_INTENSITY;
}

export const banditIntensity = (state: BanditSettings): number => normalizeBanditIntensity(state.banditIntensity);

/** Cadence and population budgets scale independently of combat strength or
 * individual party size. Doubling intensity does not also double each wave. */
export const banditPopulationCap = (state: BanditSettings & Pick<GameState, 'time'>, base: number): number =>
  rustEngine.sim_raider_population_cap(banditIntensity(state), state.time, base);
export function banditSpawnDelay(state: Pick<GameState, 'time' | 'banditIntensity' | 'banditSpawnPause'>, seconds: number): number {
  // While disabled, retain finite frozen deadlines that survive JSON saves.
  const intensity = banditIntensity(state) || state.banditSpawnPause?.intensity || DEFAULT_BANDIT_INTENSITY;
  return rustEngine.sim_raider_spawn_delay(intensity, state.banditSpawnPause?.at ?? state.time, seconds);
}
export function banditSpawnDeadline(state: Pick<GameState, 'time' | 'banditIntensity' | 'banditSpawnPause'>, seconds: number): number {
  const origin = banditIntensity(state) ? state.time : state.banditSpawnPause?.at ?? state.time;
  return origin + banditSpawnDelay(state, seconds);
}

/** Preserve progress toward each spawn when changing difficulty. Switching
 * off freezes deadlines, so resuming never catches up a backlog of raids. */
export function setBanditIntensity(state: GameState, value: unknown): void {
  const previous = banditIntensity(state), next = normalizeBanditIntensity(value);
  state.banditIntensity = next;
  if (!next) {
    state.banditSpawnPause ??= { at: state.time, intensity: previous || DEFAULT_BANDIT_INTENSITY };
    return;
  }
  if (next === previous && !state.banditSpawnPause) return;
  const origin = state.banditSpawnPause?.at ?? state.time;
  const from = state.banditSpawnPause?.intensity ?? (previous || DEFAULT_BANDIT_INTENSITY);
  const retime = (deadline: number): number => Number.isFinite(deadline)
    ? rustEngine.sim_raider_retime_spawn(from, next, origin, state.time, deadline) : deadline;
  // Announced raids keep their warning; the director re-reads intensity every second.
  for (const camp of state.raiderCamps ?? []) {
    if (camp.replacementAt !== undefined) camp.replacementAt = retime(camp.replacementAt);
    for (const key of Object.keys(camp.defenderReadyAt ?? {})) camp.defenderReadyAt![Number(key)] = retime(camp.defenderReadyAt![Number(key)]);
  }
  if (state.raiderCampPopulationRetryAt !== undefined) state.raiderCampPopulationRetryAt = retime(state.raiderCampPopulationRetryAt);
  if (state.fogRaids) state.fogRaids.nextAt = state.time;
  for (const pack of state.marauderPacks ?? []) if (pack.siegeNextReinforceAt !== undefined)
    pack.siegeNextReinforceAt = retime(pack.siegeNextReinforceAt);
  delete state.banditSpawnPause;
}
