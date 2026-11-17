import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import type { RetinueRole } from './archery';
import { BUILDING_KIND_CODES } from './entity-store';
import type { Building, Faction, GameState, Unit } from './types';

export const RETINUE_ROLES: readonly RetinueRole[] = ['knight', 'horseArcher', 'horseman', 'swordsman', 'archer', 'spearman', 'pikeman', 'musketman', 'fieldCannon', 'warrior'];
const fields = ['knightFraction', 'horseArcherFraction', 'horsemanFraction', 'swordsmanFraction', 'archerFraction', 'spearmanFraction', 'pikemanFraction', 'musketmanFraction', 'fieldCannonFraction'] as const;

/** Import effective shares, execute one Rust ECS command, then mirror its result.
 * Called only on player edits; no per-frame allocation work is introduced. */
export function allocateRetinueFraction(state: GameState, faction: Faction, role: RetinueRole,
  fraction: number, current: readonly number[], schools: readonly Building[], unlocked: number): boolean {
  const handle = simCore(state).handle, pointer = rustEngine.sim_retinue_input(handle);
  new Float64Array(rustEngine.memory.buffer, pointer, RETINUE_ROLES.length).set(current);
  const schoolMask = [...new Set(schools.map(school => BUILDING_KIND_CODES[school.kind]))].reduce((mask, kind) => mask + 2 ** kind, 0);
  if (!rustEngine.sim_retinue_set_fraction(handle, RETINUE_ROLES.indexOf(role), fraction, schoolMask, unlocked)) return false;
  const result = new Float64Array(rustEngine.memory.buffer, pointer, RETINUE_ROLES.length);
  fields.forEach((field, index) => { faction[field] = result[index]; });
  return true;
}

/** Host encoding only. Rust owns quota clipping, priority and slot rounding. */
export function nativeRetinueTargets(state: GameState, faction: Faction | undefined, total: number, unlocked: number): Record<RetinueRole, number> {
  const handle = simCore(state).handle;
  const pointer = rustEngine.sim_retinue_input(handle);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, RETINUE_ROLES.length);
  fields.forEach((field, index) => { input[index] = faction?.[field] ?? 0; });
  const output = rustEngine.sim_retinue_plan(handle, total, unlocked);
  const values = new Float64Array(rustEngine.memory.buffer, output, RETINUE_ROLES.length * 2);
  return Object.fromEntries(RETINUE_ROLES.map((role, index) => [role, values[RETINUE_ROLES.length + index]])) as Record<RetinueRole, number>;
}

/** Publish observed rosters and schools, then let the ECS choose a recruit. */
export function nativeRecruitRole(state: GameState, soldiers: readonly Unit[], schools: readonly Building[], spearsAvailable: boolean): RetinueRole {
  const handle = simCore(state).handle, pointer = rustEngine.sim_retinue_recruits_input(handle);
  const counts = new Float64Array(rustEngine.memory.buffer, pointer, RETINUE_ROLES.length);
  counts.fill(0);
  for (const unit of soldiers) {
    const index = RETINUE_ROLES.indexOf((unit.training?.role ?? unit.kind) as RetinueRole);
    if (index >= 0) counts[index]++;
  }
  const mask = [...new Set(schools.map(school => BUILDING_KIND_CODES[school.kind]))].reduce((value, kind) => value + 2 ** kind, 0);
  return RETINUE_ROLES[rustEngine.sim_retinue_recruit(handle, mask, Number(spearsAvailable))];
}
