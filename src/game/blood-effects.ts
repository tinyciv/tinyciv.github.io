import type { BloodEffect, Building, GameState, Point, Unit } from './types';

export const BLOOD_EFFECT_DURATION = .26;
export const MAX_BLOOD_EFFECTS = 96;

/** Record contact, not an attack attempt. Fatal strikes retain their impact position. */
export function recordBloodHit(state: GameState, target: Unit | Building, source: Point): void {
    if ('capacity' in target || target.hp <= 0 || target.inside) return;
    const effects = state.bloodEffects ??= [];
    if (effects.length >= MAX_BLOOD_EFFECTS) effects.splice(0, effects.length - MAX_BLOOD_EFFECTS + 1);
    effects.push({ x: target.x, y: target.y, elapsed: 0,
        angle: Math.atan2(target.y - source.y, target.x - source.x),
        height: (target.kind === 'horseman' || target.kind === 'horseArcher' || target.kind === 'knight') ? .55 : ['leader', 'warrior', 'swordsman', 'slinger', 'militia', 'worker'].includes(target.kind) ? .43 : .24 });
}

export function updateBloodEffects(state: GameState, dt: number): void {
    if (!state.bloodEffects?.length) return;
    // Compact in place: even crowded battles allocate no per-frame effect arrays.
    let kept = 0;
    for (const effect of state.bloodEffects) {
        effect.elapsed += dt;
        if (effect.elapsed < BLOOD_EFFECT_DURATION) state.bloodEffects[kept++] = effect;
    }
    state.bloodEffects.length = kept;
}
