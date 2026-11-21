import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import type { RetinueRole } from './archery';
import { BUILDING_KIND_CODES } from './entity-store';
import { recordGoldOutlay } from './gold-ledger';
import { structureIndex } from './structure-index';
import type { Building, Faction, GameState, Unit } from './types';

export const RETINUE_ROLES: readonly RetinueRole[] = ['knight', 'horseArcher', 'horseman', 'swordsman', 'archer', 'spearman', 'pikeman', 'musketman', 'fieldCannon', 'warrior'];
const fields = ['knightFraction', 'horseArcherFraction', 'horsemanFraction', 'swordsmanFraction', 'archerFraction', 'spearmanFraction', 'pikemanFraction', 'musketmanFraction', 'fieldCannonFraction'] as const;
const schoolMask = (schools: readonly Building[]): number =>
  [...new Set(schools.map(school => BUILDING_KIND_CODES[school.kind]))].reduce((mask, kind) => mask + 2 ** kind, 0);

function writeComposition(handle: number, faction: Faction | undefined): number {
  const pointer = rustEngine.sim_retinue_input(handle);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, RETINUE_ROLES.length);
  fields.forEach((field, index) => { input[index] = faction?.[field] ?? 0; });
  return pointer;
}

function mirrorComposition(pointer: number, faction: Faction): void {
  const result = new Float64Array(rustEngine.memory.buffer, pointer, RETINUE_ROLES.length);
  fields.forEach((field, index) => { faction[field] = result[index]; });
}

export function settleRetinuePayroll(state: GameState, faction: Faction, due: number): void {
  const pointer = rustEngine.sim_retinue_payroll(simCore(state).handle, faction.gold, due);
  const [remaining, paid, funded] = new Float64Array(rustEngine.memory.buffer, pointer, 3);
  faction.gold = remaining;
  faction.retinueFunded = !!funded;
  recordGoldOutlay(state, faction, paid, 'army');
}

export function retinueRecruitmentDue(state: GameState, faction: Faction, startingEscort: boolean): boolean {
  if (!startingEscort && faction.nextRetinueAt === Infinity) return false;
  structureIndex(state);
  const pointer = rustEngine.sim_retinue_recruitment_tick(simCore(state).handle, faction.id, state.time,
    faction.nextRetinueAt ?? NaN, faction.retinueRecruitmentInterval ?? NaN, Number(startingEscort));
  const [deadline, interval, due] = new Float64Array(rustEngine.memory.buffer, pointer, 3);
  faction.nextRetinueAt = deadline;
  faction.retinueRecruitmentInterval = interval;
  return !!due;
}

/** Import effective shares, execute one Rust ECS command, then mirror its result.
 * Called only on player edits; no per-frame allocation work is introduced. */
export function allocateRetinueFraction(state: GameState, faction: Faction, role: RetinueRole,
  fraction: number, current: readonly number[], schools: readonly Building[], unlocked: number): boolean {
  const handle = simCore(state).handle, pointer = rustEngine.sim_retinue_input(handle);
  new Float64Array(rustEngine.memory.buffer, pointer, RETINUE_ROLES.length).set(current);
  if (!rustEngine.sim_retinue_set_fraction(handle, RETINUE_ROLES.indexOf(role), fraction, schoolMask(schools), unlocked)) return false;
  mirrorComposition(pointer, faction);
  return true;
}

export function allocateRetinueCount(state: GameState, faction: Faction, role: RetinueRole, count: number,
  total: number, schools: readonly Building[], unlocked: number, trainable: number): boolean {
  const handle = simCore(state).handle, pointer = writeComposition(handle, faction);
  if (!rustEngine.sim_retinue_set_count(handle, RETINUE_ROLES.indexOf(role), count, total, schoolMask(schools), unlocked, trainable)) return false;
  mirrorComposition(pointer, faction);
  return true;
}

/** Host encoding only. Rust owns quota clipping, priority and slot rounding. */
export function nativeRetinueTargets(state: GameState, faction: Faction | undefined, total: number, unlocked: number): Record<RetinueRole, number> {
  const handle = simCore(state).handle;
  writeComposition(handle, faction);
  const output = rustEngine.sim_retinue_plan(handle, total, unlocked);
  const values = new Float64Array(rustEngine.memory.buffer, output, RETINUE_ROLES.length * 2);
  return Object.fromEntries(RETINUE_ROLES.map((role, index) => [role, values[RETINUE_ROLES.length + index]])) as Record<RetinueRole, number>;
}

/** Publish observed rosters and schools, then let the ECS choose a recruit. */
export function nativeRecruitRole(state: GameState, soldiers: readonly Unit[], schools: readonly Building[],
  spearsAvailable: boolean, horsesAvailable: boolean): RetinueRole {
  const handle = simCore(state).handle, pointer = rustEngine.sim_retinue_recruits_input(handle);
  const counts = new Float64Array(rustEngine.memory.buffer, pointer, RETINUE_ROLES.length);
  counts.fill(0);
  for (const unit of soldiers) {
    const index = RETINUE_ROLES.indexOf((unit.training?.role ?? unit.kind) as RetinueRole);
    if (index >= 0) counts[index]++;
  }
  return RETINUE_ROLES[rustEngine.sim_retinue_recruit(handle, schoolMask(schools), Number(spearsAvailable), Number(horsesAvailable))];
}
