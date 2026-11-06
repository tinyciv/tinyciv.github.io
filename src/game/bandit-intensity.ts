import type { GameState } from './types';

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
export const banditPopulationCap = (state: BanditSettings, base: number): number => Math.floor(base * banditIntensity(state));
export function banditSpawnDelay(state: Pick<GameState, 'banditIntensity' | 'banditSpawnPause'>, seconds: number): number {
  // While disabled, retain finite frozen deadlines that survive JSON saves.
  return seconds / (banditIntensity(state) || state.banditSpawnPause?.intensity || DEFAULT_BANDIT_INTENSITY);
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
    for (const camp of state.raiderCamps ?? []) camp.pressureUpdatedAt = state.time;
    return;
  }
  if (next === previous && !state.banditSpawnPause) return;
  const origin = state.banditSpawnPause?.at ?? state.time;
  const ratio = (state.banditSpawnPause?.intensity ?? (previous || DEFAULT_BANDIT_INTENSITY)) / next;
  const retime = (deadline: number): number => Number.isFinite(deadline)
    ? state.time + Math.max(0, deadline - origin) * ratio : deadline;
  for (const camp of state.raiderCamps ?? []) {
    camp.pressureUpdatedAt = state.time;
    camp.nextRaidAt = retime(camp.nextRaidAt);
    if (camp.replacementAt !== undefined) camp.replacementAt = retime(camp.replacementAt);
    for (const key of Object.keys(camp.defenderReadyAt ?? {})) camp.defenderReadyAt![Number(key)] = retime(camp.defenderReadyAt![Number(key)]);
  }
  if (state.raiderCampPopulationRetryAt !== undefined) state.raiderCampPopulationRetryAt = retime(state.raiderCampPopulationRetryAt);
  if (state.fogRaids) state.fogRaids.nextAt = retime(state.fogRaids.nextAt);
  for (const pack of state.marauderPacks ?? []) if (pack.siegeNextReinforceAt !== undefined)
    pack.siegeNextReinforceAt = retime(pack.siegeNextReinforceAt);
  const skirmishes = state.raiderSkirmishes?.nextByFaction;
  for (const key of Object.keys(skirmishes ?? {})) skirmishes![Number(key)] = retime(skirmishes![Number(key)]);
  delete state.banditSpawnPause;
}
