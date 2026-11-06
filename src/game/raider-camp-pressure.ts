import { banditIntensity } from './bandit-intensity';
import { raiderCampActive } from './raider-camps';
import type { GameState, RaiderCamp, Unit } from './types';

export const RAIDER_CAMP_PRESSURE_SECONDS = 10;
export const RAIDER_CAMP_PRESSURE_RADIUS = 3;

function advancePressure(state: GameState, camp: RaiderCamp): boolean {
  const previous = camp.pressureUpdatedAt ?? state.time;
  const extra = Math.max(0, Math.min(state.time, camp.pressureUntil ?? -Infinity) - previous);
  camp.pressureUpdatedAt = state.time;
  if (!extra || !banditIntensity(state) || !raiderCampActive(state, camp)) return false;
  // One extra second of recruitment for each real second under pressure: 2×,
  // never repeated multiplicative halving on every hit or proximity check.
  camp.nextRaidAt = Math.max(state.time, camp.nextRaidAt - extra);
  // Damage can advance this clock just before the same frame's raid update.
  // Wake the global scheduler even when that update has zero elapsed time.
  if (state.fogRaids) state.fogRaids.nextAt = Math.min(state.fogRaids.nextAt, camp.nextRaidAt);
  for (const id of Object.keys(camp.defenderReadyAt ?? {})) {
    const ready = camp.defenderReadyAt![Number(id)];
    if (ready > state.time) camp.defenderReadyAt![Number(id)] = Math.max(state.time, ready - extra);
  }
  for (const pack of state.marauderPacks ?? []) if (pack.raiderCamp === camp.id && pack.siegeNextReinforceAt !== undefined)
    pack.siegeNextReinforceAt = Math.max(state.time, pack.siegeNextReinforceAt - extra);
  return true;
}

export function refreshRaiderCampPressure(state: GameState, camp: RaiderCamp): void {
  advancePressure(state, camp);
  camp.pressureUntil = state.time + RAIDER_CAMP_PRESSURE_SECONDS;
}

function nearby(camp: RaiderCamp, unit: Unit): boolean {
  const dx = Math.max(camp.x - unit.x, 0, unit.x - camp.x - camp.width);
  const dy = Math.max(camp.y - unit.y, 0, unit.y - camp.y - camp.height);
  return dx * dx + dy * dy <= RAIDER_CAMP_PRESSURE_RADIUS ** 2;
}

/** Uses actual civilization visitors, including ones hidden from the player;
 * neutral villages and units sheltering inside buildings do not provoke it. */
export function updateRaiderCampPressure(state: GameState): boolean {
  const factions = new Set(state.factions.filter(faction => faction.id >= 0 && faction.villageId === undefined && !faction.defeated).map(faction => faction.id));
  const visitors = state.units.filter(unit => unit.hp > 0 && !unit.inside && factions.has(unit.faction));
  let changed = false;
  for (const camp of state.raiderCamps ?? []) {
    changed = advancePressure(state, camp) || changed;
    if (raiderCampActive(state, camp) && visitors.some(unit => nearby(camp, unit)))
      camp.pressureUntil = state.time + RAIDER_CAMP_PRESSURE_SECONDS;
  }
  return changed;
}
