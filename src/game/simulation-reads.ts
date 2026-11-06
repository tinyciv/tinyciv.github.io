import type { GameState } from './types';

const readers = new WeakSet<GameState>();
const structures = new WeakMap<GameState, number>();

/** The simulation owns its mutations: entity lifetime uses EntityStore and
 * access/ownership edits invalidate navigation. Inside this boundary derived
 * views can trust those revisions instead of comparing every building on each
 * query. Standalone editor/query callers retain scalar reconciliation. */
export function withSimulationReads<T>(state: GameState, run: () => T): T {
  if (readers.has(state)) return run();
  readers.add(state);
  try { return run(); } finally { readers.delete(state); }
}

export function simulationReadsActive(state: GameState): boolean { return readers.has(state); }
export function structureChangeRevision(state: GameState): number { return structures.get(state) ?? 0; }
export function recordStructureChange(state: GameState): void {
  structures.set(state, structureChangeRevision(state) + 1);
}
