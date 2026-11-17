import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { structureIndex } from './structure-index';
import { playerFaction } from './player-context';
import { invalidateDecisions } from './decision-schedule';
import type { GameState, MilitaryFormationType } from './types';

export type { MilitaryFormationType } from './types';
export const MILITARY_ACADEMY_GOLD = rustEngine.military_academy_constant(0);
export const MILITARY_ACADEMY_HP = rustEngine.military_academy_constant(1);
export const MILITARY_FORMATION_TYPES: readonly MilitaryFormationType[] = ['wide', 'standard', 'deep'];
export const militaryFormationCode = (type: MilitaryFormationType | undefined): number => type === 'wide' ? 0 : type === 'deep' ? 2 : 1;
const fromCode = (code: number): MilitaryFormationType => MILITARY_FORMATION_TYPES[code] ?? 'standard';

/** Structure events maintain the native academy counts. These calls only
 * publish the faction's research/preference mirrors and read native rules. */
function sync(state: GameState, faction: number): number {
  structureIndex(state);
  const handle = simCore(state).handle, owner = state.factions.find(candidate => candidate.id === faction);
  rustEngine.sim_academy_faction(handle, faction, owner?.research?.levels.militaryScience ?? NaN, militaryFormationCode(owner?.formationType));
  return handle;
}
export function militaryFormationControl(state: GameState, faction = playerFaction(state)) {
  const handle = sync(state, faction), status = rustEngine.sim_academy_status(handle, faction);
  return { type: fromCode(rustEngine.sim_academy_type(handle, faction)), unlocked: !!(status & 1), academy: !!(status & 2), enabled: status === 3 };
}
export function militaryFormationType(state: GameState, faction: number): MilitaryFormationType {
  return fromCode(rustEngine.sim_academy_type(sync(state, faction), faction));
}
export function selectMilitaryFormation(state: GameState, type: MilitaryFormationType, faction = playerFaction(state)): { ok: boolean; message: string } {
  const handle = sync(state, faction), owner = state.factions.find(candidate => candidate.id === faction);
  if (!owner || !rustEngine.sim_academy_select(handle, faction, militaryFormationCode(type)))
    return { ok: false, message: 'Requires Military Science and a completed Military Academy.' };
  owner.formationType = type;
  invalidateDecisions(state);
  return { ok: true, message: `${type[0].toUpperCase()}${type.slice(1)} formation selected.` };
}
