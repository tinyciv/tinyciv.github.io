import type { GameState, Point } from './types';

const HOLD_SECONDS = 5;
const FADE_SECONDS = 1;
const LIFETIME = HOLD_SECONDS + FADE_SECONDS;
const NOISE_SPEED = .12;
const WIND_SPEED = NOISE_SPEED * .1;

export interface GunSmoke extends Point {
  startedAt: number;
  height: number;
  heavy: boolean;
  seed: number;
}

function mix(bits: number): number {
  bits = Math.imul(bits ^ (bits >>> 16), 0x7feb352d);
  bits = Math.imul(bits ^ (bits >>> 15), 0x846ca68b);
  return (bits ^ (bits >>> 16)) >>> 0;
}

/** Record the muzzle in world coordinates at the moment a weapon fires. */
export function recordGunSmoke(state: GameState, origin: Point, facing: number, id: number,
  heavy: boolean, height: number, slot = 0): void {
  const muzzle = heavy ? .42 : .32;
  // An effect seed stays deterministic without advancing the simulation RNG.
  const seed = mix(id ^ Math.imul(Math.round(state.time * 1000), 31) ^ Math.imul(slot, 0x9e3779b1));
  (state.gunSmoke ??= []).push({ x: origin.x + Math.cos(facing) * muzzle,
    y: origin.y + Math.sin(facing) * muzzle, startedAt: state.time, height, heavy, seed });
}

export function expireGunSmoke(state: GameState): void {
  const smoke = state.gunSmoke;
  if (!smoke?.length) return;
  let expired = 0;
  while (expired < smoke.length && state.time - smoke[expired].startedAt >= LIFETIME) expired++;
  if (expired === smoke.length) delete state.gunSmoke;
  else if (expired) state.gunSmoke = smoke.slice(expired);
}

export function gunSmokePose(puff: GunSmoke, time: number) {
  const age = time - puff.startedAt;
  if (age < 0 || age >= LIFETIME) return;
  const noiseX = (puff.seed & 0xffff) / 32767.5 - 1;
  const noiseY = (puff.seed >>> 16) / 32767.5 - 1;
  const growth = Math.sqrt(Math.min(1, age / HOLD_SECONDS));
  const fade = Math.min(1, (LIFETIME - age) / FADE_SECONDS);
  return { x: puff.x + age * (WIND_SPEED + NOISE_SPEED * noiseX), y: puff.y + age * NOISE_SPEED * noiseY,
    size: (puff.heavy ? 1.3 : .85) * (1 + growth * 1.25), alpha: (puff.heavy ? .56 : .37) * Math.min(1, age / .16) * fade,
    variant: puff.seed % 3 };
}
