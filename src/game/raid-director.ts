import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { banditIntensity } from './bandit-intensity';
import { buildingReady, isSoldier, isWallKind, type Building, type Faction, type GameState, type MarauderPack, type Unit } from './types';

/** Host bridge to rust/src/sim/raid_director.rs. Rust owns each realm's
 * Calm → Build-up → Raid → Respite cycle, stress, era strength and raid
 * choice; this module reports losses and exposes the native answers. */
export const RAID_PHASES = ['calm', 'buildup', 'raid', 'respite'] as const;
export type RaidPhase = typeof RAID_PHASES[number];
export const RAID_MOTIVES = ['assault', 'harass', 'theft', 'siege', 'sea'] as const;
export type RaidMotive = typeof RAID_MOTIVES[number];
export const RAID_CANDIDATE_WORDS = 7;
const RAIDER_FACTION = -2;

const handle = (state: GameState): number => simCore(state).handle;

/** Realms the director paces: living, full civilizations. */
export function directedFactions(state: GameState): Faction[] {
  return state.factions.filter(faction => faction.id >= 0 && faction.villageId === undefined && !faction.defeated && faction.relation !== 'confederated');
}

export const raidProfile = (era: number): { hp: number; attack: number; defense: number } =>
  ({ hp: rustEngine.raid_profile(era, 0), attack: rustEngine.raid_profile(era, 1), defense: rustEngine.raid_profile(era, 2) });
export const raidEquipment = (era: number): number => rustEngine.raid_equipment(era);
export const raidArcherFraction = (era: number): number => rustEngine.raid_archer_fraction(era);
export const raidSeaFleet = (era: number): number => rustEngine.raid_sea_fleet(era);
export const raidSeaProfile = (era: number): { hp: number; attack: number; defense: number } =>
  ({ hp: rustEngine.raid_sea_profile(era, 0), attack: rustEngine.raid_sea_profile(era, 1), defense: rustEngine.raid_sea_profile(era, 2) });

/** Last sampled progress era of a realm; the strongest era for wilderness raiders. */
export function raidEra(state: GameState, faction?: number): number {
  if (faction !== undefined && faction >= 0) return rustEngine.sim_raid_era(handle(state), faction);
  let era = 0;
  for (const owner of directedFactions(state)) era = Math.max(era, rustEngine.sim_raid_era(handle(state), owner.id));
  return era;
}
export const raidDirectorOpen = (state: GameState, faction: number): boolean => !!rustEngine.sim_raid_open(handle(state), faction);
export const raidDirectorPacified = (state: GameState, faction: number): boolean => !!rustEngine.sim_raid_pacified(handle(state), faction, state.time);
export const pacifyRaidRegion = (state: GameState, faction: number): void => { if (faction >= 0) rustEngine.sim_raid_pacify(handle(state), faction, state.time); };

export interface RaidFacts { techs: number; population: number; gold: number; soldiers: number; towers: number; active: number; alive: boolean }
/** Returns the raid size to field now, or 0. Answer with launched/defer. */
export function stepRaidDirector(state: GameState, faction: number, facts: RaidFacts): number {
  return rustEngine.sim_raid_step(handle(state), faction, state.time, banditIntensity(state), facts.techs, facts.population,
    facts.gold, facts.soldiers, facts.towers, facts.active, Number(facts.alive));
}
export const raidDirectorDefer = (state: GameState, faction: number): void => rustEngine.sim_raid_defer(handle(state), faction);
export const resetRaidDirector = (state: GameState): void => rustEngine.sim_raid_reset(handle(state));
export const raidDirectorLaunched = (state: GameState, faction: number, raiders: number, motive: RaidMotive, bands = 1): void =>
  rustEngine.sim_raid_launched(handle(state), faction, state.time, raiders, RAID_MOTIVES.indexOf(motive), bands);
export const raidDirectorCancel = (state: GameState, faction: number, raiders: number): void => rustEngine.sim_raid_cancel(handle(state), faction, raiders);
export const raidDirectorClaimSea = (state: GameState, faction: number, active: number): boolean =>
  !!rustEngine.sim_raid_claim_sea(handle(state), faction, banditIntensity(state), active);

export interface RaidCandidate { camp: number; city: number; route: number; defense: number; loot: number; keep: boolean; waves: number }
export interface RaidChoice { index: number; motive: Exclude<RaidMotive, 'sea'>; initial: number; total: number; warning: number; bands: number }
export function chooseRaid(state: GameState, faction: number, candidates: readonly RaidCandidate[], budget: number, gold: number, soldiers: number): RaidChoice | undefined {
  if (!candidates.length) return;
  const sim = handle(state), pointer = rustEngine.sim_raid_input(sim, candidates.length);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, candidates.length * RAID_CANDIDATE_WORDS);
  candidates.forEach((row, index) => input.set([row.camp, row.city, row.route, row.defense, row.loot, Number(row.keep), row.waves], index * RAID_CANDIDATE_WORDS));
  const out = new Float64Array(rustEngine.memory.buffer, rustEngine.sim_raid_choose(sim, faction, budget, gold, soldiers, candidates.length), 6);
  if (out[0] < 0) return;
  const motive = RAID_MOTIVES[out[1]];
  return { index: out[0], motive: motive === undefined || motive === 'sea' ? 'assault' : motive,
    initial: out[2], total: out[3], warning: out[4], bands: out[5] };
}

export interface RaidDirectorView {
  phase: RaidPhase; until: number; stress: number; points: number; era: number; fear: number; streak: number; raids: number;
  pacifiedUntil: number; vendetta: boolean; phaseSeconds: Record<RaidPhase, number>; raidersSent: number; raidersLost: number;
  totalStress: number; peakStress: number; sizeRelief: number; lastMotive?: RaidMotive;
}
export function raidDirectorView(state: GameState, faction: number): RaidDirectorView | undefined {
  const v = new Float64Array(rustEngine.memory.buffer, rustEngine.sim_raid_view(handle(state), faction), 20);
  if (v[0] < 0) return;
  return { phase: RAID_PHASES[v[0]], until: v[1], stress: v[2], points: v[3], era: v[4], fear: v[5], streak: v[6], raids: v[7],
    pacifiedUntil: v[8], vendetta: v[9] > 0, phaseSeconds: { calm: v[10], buildup: v[11], raid: v[12], respite: v[13] },
    raidersSent: v[14], raidersLost: v[15], totalStress: v[16], peakStress: v[17], sizeRelief: v[18],
    lastMotive: v[19] >= 0 ? RAID_MOTIVES[v[19]] : undefined };
}

function lossWeight(state: GameState, target: Unit | Building): number {
  if ('capacity' in target) {
    if (!buildingReady(target)) return 1;
    if (target.kind === 'palace') return 10;
    if (target.kind === 'fort') return 6;
    return isWallKind(target.kind) || target.kind === 'road' || target.kind === 'bridge' ? .5 : 3;
  }
  if (target.kind === 'leader') return 10;
  return isSoldier(target) || target.kind === 'militia' || target.kind === 'levyInfantry' ? 1.5 : 1;
}
/** Every death or destruction: raider-caused losses raise the victim realm's
 * stress; a raider's death counts against the raid that sent it. */
export function recordRaidCasualty(state: GameState, attackerFaction: number, target: Unit | Building): void {
  if (target.faction === RAIDER_FACTION) {
    if ('capacity' in target || target.marauderPack === undefined) return;
    const pack = state.marauderPacks?.find(candidate => candidate.id === target.marauderPack);
    if (pack?.directorFaction !== undefined) rustEngine.sim_raid_raider_lost(handle(state), pack.directorFaction);
    return;
  }
  if (attackerFaction !== RAIDER_FACTION || target.faction < 0) return;
  rustEngine.sim_raid_loss(handle(state), target.faction, state.time, lossWeight(state, target));
}
export function recordRaidTheft(state: GameState, faction: number, gold: number): void {
  if (faction >= 0 && gold > 0) rustEngine.sim_raid_loss(handle(state), faction, state.time, gold / 50);
}
/** Packs currently counted as one realm's raid. */
export const directedPack = (pack: MarauderPack, faction: number): boolean => pack.directorFaction === faction && !pack.returning;
