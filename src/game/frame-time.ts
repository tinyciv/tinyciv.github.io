/** A delayed animation frame must not turn into several simulation steps and
 * delay the next frame again. Normal 30 Hz play still supports 1×–3×; at 4× or
 * under overload the simulation advances as fast as one safe step permits. */
export function frameSimulationDelta(elapsedSeconds: number, speed: number): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
  return Math.min(elapsedSeconds, .1 / Math.max(1, speed));
}
