import type { GameState } from './types';

/** Debug-only orchestration trace used by tests/orchestration-trace.test.ts.
 * `stepGame` reports its phase boundaries and the recurring-work and
 * settlement-decision schedulers report each key they actually run. Production
 * never installs a sink; every call site is one undefined check.
 *
 * The sink receives the live RNG state, so a consumer derives the number of
 * mulberry32 draws between two events without instrumenting each generator. */
export type OrchestrationEventKind = 'update' | 'substep' | 'phase' | 'work' | 'decision';
export type OrchestrationTraceSink = (state: GameState, kind: OrchestrationEventKind, key: string) => void;

let sink: OrchestrationTraceSink | undefined;

export function setOrchestrationTraceSink(next: OrchestrationTraceSink | undefined): void { sink = next; }

export function traceOrchestration(state: GameState, kind: OrchestrationEventKind, key: string): void {
  if (sink !== undefined) sink(state, kind, key);
}

/** Every simulation RNG draw advances `rngState` by this odd constant (mod 2^32). */
const MULBERRY32_INCREMENT = 0x6D2B79F5;
// Multiplicative inverse of the increment modulo 2^32 (Newton iteration).
const MULBERRY32_INVERSE = (() => {
  let inverse = MULBERRY32_INCREMENT;
  for (let i = 0; i < 5; i++) inverse = Math.imul(inverse, 2 - Math.imul(MULBERRY32_INCREMENT, inverse));
  return inverse >>> 0;
})();

/** Number of mulberry32 draws that moved `before` to `after` (mod 2^32). */
export function rngDrawsBetween(before: number, after: number): number {
  return Math.imul((after - before) >>> 0, MULBERRY32_INVERSE) >>> 0;
}
