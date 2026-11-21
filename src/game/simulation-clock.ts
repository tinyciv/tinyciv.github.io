export const MAX_SIMULATION_STEP_SECONDS = .1;

export const SIMULATION_UPDATE_MS = 1000 / 60;
export const SIMULATION_TURN_BUDGET_MS = 10;
export const FAST_FORWARD_TURN_BUDGET_MS = 20;
export const FAST_FORWARD_DRAW_INTERVAL_MS = 50;
const FAST_FORWARD_MIN_SPEED = 16;

/** The browser host keeps earned game time until the simulation consumes it. */
export class SimulationClock {
  private lastAt = 0;
  private speed = 0;
  private pendingSeconds = 0;

  reset(now: number): void {
    this.lastAt = now;
    this.speed = 0;
    this.pendingSeconds = 0;
  }

  sample(now: number, speed: number): void {
    this.pendingSeconds += Math.max(0, now - this.lastAt) / 1000 * this.speed;
    this.lastAt = now;
    this.speed = Number.isFinite(speed) && speed > 0 ? speed : 0;
  }

  get stepSeconds(): number {
    // Keep normal play responsive and bound movement and collision steps at high speeds.
    return Math.min(MAX_SIMULATION_STEP_SECONDS, this.speed * SIMULATION_UPDATE_MS / 1000);
  }

  get dueSteps(): number {
    const step = this.stepSeconds;
    return step > 0 ? Math.floor((this.pendingSeconds + 1e-9) / step) : 0;
  }

  get fastForwardBehind(): boolean {
    // Absorb ordinary timer jitter before trading some world draws for simulation work.
    return this.speed >= FAST_FORWARD_MIN_SPEED && this.pendingSeconds >= this.speed * 2 * SIMULATION_UPDATE_MS / 1000;
  }

  consume(seconds: number): void {
    this.pendingSeconds = Math.max(0, this.pendingSeconds - seconds);
  }
}
