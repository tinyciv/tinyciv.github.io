import { UNIT_KIND_CODES } from './entity-store';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import type { Faction, GameState, Unit } from './types';

export interface CampaignStats {
  goldGathered: number; enemiesKilled: number; unitsLost: number;
  technologiesResearched: number; maximumPopulation: number;
}
/** Scalar observations only; native counters own accumulation and deduplication. */
export function recordCampaignCasualty(state: GameState, unit: Unit, killer = -1, hostile = false): void {
  rustEngine.sim_campaign_casualty(simCore(state).handle, unit.id, unit.faction, UNIT_KIND_CODES[unit.kind], killer, Number(hostile));
}
export function recordCampaignPopulation(state: GameState, faction: Faction): void {
  rustEngine.sim_campaign_population(simCore(state).handle, faction.id, faction.population);
}
export function campaignStats(state: GameState, faction: Faction): CampaignStats {
  recordCampaignPopulation(state, faction);
  const pointer = rustEngine.sim_campaign_view(simCore(state).handle, faction.id);
  const [goldGathered, enemiesKilled, unitsLost, technologiesResearched, maximumPopulation] = new Float64Array(rustEngine.memory.buffer, pointer, 5);
  return { goldGathered, enemiesKilled, unitsLost, technologiesResearched, maximumPopulation };
}
