import { isMountedKind, type GameState, type UnitKind } from './types';

/** Presentation-only clock: sparse network ticks must not freeze a horse's gait.
 * Combat timing and world simulation continue to use authoritative state.time. */
export class MountedAnimationClock {
  time = 0;

  advance(dt: number, state: Pick<GameState, 'paused' | 'gameOver' | 'speed'>): number {
    if (!state.paused && !state.gameOver)
      this.time += Math.max(0, Math.min(dt, .15)) * state.speed;
    return this.time;
  }

  forUnit(kind: UnitKind, simulationTime: number): number {
    return isMountedKind(kind) || kind === 'merchant' || kind === 'supplyCart' || kind === 'leader' ? this.time : simulationTime;
  }
}
