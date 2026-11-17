import { describe, expect, it } from 'vitest';
import { MountedAnimationClock } from '../src/game/mounted-animation';
import { horsemanPose } from '../src/game/cavalry-art';
import { merchantFrame } from '../src/game/merchant-art';

describe('mounted movement presentation', () => {
  it.each([1, 2, 4])('plays every walk frame between network updates at %sx speed', speed => {
    for (const kind of ['horseman', 'horseArcher', 'knight', 'merchant'] as const) {
      for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const clock = new MountedAnimationClock(), frames = new Set<number>();
        const unit = { id: 0, facing, moving: true, attackTime: 0 };
        for (let frame = 0; frame < 60; frame++) {
          clock.advance(1 / 60, { paused: false, gameOver: false, speed });
          // Deliberately hold the authoritative simulation time fixed.
          const time = clock.forUnit(kind, 20);
          frames.add(kind === 'merchant' ? merchantFrame(unit, time).column : horsemanPose(unit, time).rect[0] / 32);
        }
        expect([...frames].sort()).toEqual([0, 1, 2, 3]);
      }
    }
  });

  it('freezes on pause/game over and leaves infantry and combat timing authoritative', () => {
    const clock = new MountedAnimationClock();
    const playing = { paused: false, gameOver: false, speed: 1 };
    clock.advance(.1, playing);
    expect(clock.advance(.1, { ...playing, paused: true })).toBe(.1);
    expect(clock.advance(.1, { ...playing, gameOver: true })).toBe(.1);
    expect(clock.forUnit('warrior', 25)).toBe(25);
    const attacker = { id: 0, facing: 0, moving: true, attackTime: .14 };
    expect(horsemanPose(attacker, 0)).toEqual(horsemanPose(attacker, 99));
  });
});
