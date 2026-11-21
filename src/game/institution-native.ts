import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import type { BuildingKind, GameState } from './types';

export const INSTITUTION_KIND = { granary: 0, barracks: 1, forum: 2, apartments: 4, factory: 5 } as const;
export type InstitutionKind = keyof typeof INSTITUTION_KIND;
export const INSTITUTION_COST = Object.freeze(Object.fromEntries(Object.entries(INSTITUTION_KIND)
  .map(([name, code]) => [name, rustEngine.ai_investment_constant(code, 0)]))) as Readonly<Record<InstitutionKind, number>>;
export const INSTITUTION_UPKEEP = Object.freeze(Object.fromEntries(Object.entries(INSTITUTION_KIND)
  .map(([name, code]) => [name, rustEngine.ai_investment_constant(code, 1)]))) as Readonly<Record<InstitutionKind, number>>;
export function institutionUpkeep(kind: BuildingKind): number {
  return Object.hasOwn(INSTITUTION_KIND, kind) ? INSTITUTION_UPKEEP[kind as InstitutionKind] : 0;
}
/** Observation/command bridge only. Rust owns every investment decision. */
export function nativeInstitutionPlan(state: GameState, faction: number, mode: number, facts: readonly number[]): number[] {
  const handle = simCore(state).handle, pointer = rustEngine.sim_ai_investment_input(handle, facts.length);
  if (!pointer) throw new Error('AI institution observation budget exceeded');
  new Float64Array(rustEngine.memory.buffer, pointer, facts.length).set(facts);
  const result = rustEngine.sim_ai_investment_plan(handle, faction, mode);
  const count = new Float64Array(rustEngine.memory.buffer, result, 1)[0];
  return Array.from(new Float64Array(rustEngine.memory.buffer, result + 8, count));
}
