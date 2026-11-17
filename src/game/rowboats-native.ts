import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { UNIT_KIND_CODES } from './entity-store';
import type { GameState, Unit } from './types';

export function canUseRowboat(unit: Unit): boolean {
  return !!rustEngine.rowboat_eligible(UNIT_KIND_CODES[unit.kind], Number(!!unit.engineer));
}

/** Encode observations only; the ECS decides embarkation and travel costs. */
export function rowboatProfile(state: GameState, cells: readonly number[], land: Uint8Array, cost: Float64Array,
  water: (cell: number) => boolean): Float64Array {
  const handle = simCore(state).handle, pointer = rustEngine.sim_rowboat_input(handle, cells.length);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, cells.length * 4);
  cells.forEach((cell, row) => {
    const offset = row * 4;
    input[offset] = cell; input[offset + 1] = land[cell]; input[offset + 2] = cost[cell]; input[offset + 3] = Number(water(cell));
  });
  const result = rustEngine.sim_rowboat_profile(handle, cells.length);
  return new Float64Array(rustEngine.memory.buffer, result, cells.length * 3).slice();
}

export function mirrorRowboat(state: GameState, unit: Unit, land: boolean, water: boolean, bridge: boolean): void {
  unit.aboardRowboat = !!rustEngine.sim_rowboat_aboard(simCore(state).handle, UNIT_KIND_CODES[unit.kind],
    Number(!!unit.engineer), Number(land), Number(water), Number(bridge));
}
