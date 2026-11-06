import { describe, expect, it } from 'vitest';
import { DAMAGE_NUMBER_DURATION, damageNumberPose, recordUnitDamage } from '../src/game/combat-feedback';
import { type GameState, type Unit } from '../src/game/types';
import { RespawnCamera } from '../src/ui/respawn-camera';
function soldier(id: number, x: number, faction = 0): Unit {
  return { id, kind: 'warrior', faction, x, y: 5.5, hp: 80, maxHp: 100, morale: 100, attack: 17, defense: 4,
    speed: 3, range: 1.1, order: 'follow', retinueStance: 'defensive', defensiveAnchor: { x, y: 5.5 },
    cooldown: 0, lastCombat: -60, facing: 0, moving: false, attackTime: 0 };
}
function game(): GameState {
  return { units: [soldier(1, 5.5), soldier(2, 9.5), soldier(3, 12.5), soldier(4, 7.5, 1)],
    buildings: [], factions: [], time: 3, particles: [], world: { width: 20, height: 20, tiles: [] } } as unknown as GameState;
}
describe('combat feedback', () => {
  it('reports actual HP loss once and alerts only nearby friendly defensive posts', () => {
    const state = game(); recordUnitDamage(state, state.units[0], 100, 55);
    expect(state.particles).toHaveLength(1);
    expect(state.particles[0]).toMatchObject({ text: '-20', kind: 'damage', life: DAMAGE_NUMBER_DURATION });
    expect(state.units[0].defensiveThreat).toEqual({ target: 55, until: 7 });
    expect(state.units[1].defensiveThreat).toEqual({ target: 55, until: 7 });
    expect(state.units[2].defensiveThreat).toBeUndefined(); expect(state.units[3].defensiveThreat).toBeUndefined();
    recordUnitDamage(state, state.units[0], 80, 55); expect(state.particles).toHaveLength(1);
  });
  it('caps fatal hits at remaining HP and bounds the live label count', () => {
    const state = game(), target = state.units[0]; target.hp = 0;
    recordUnitDamage(state, target, 7); expect(state.particles[0].text).toBe('-7');
    for (let i = 0; i < 400; i++) recordUnitDamage(state, target, 7);
    expect(state.particles).toHaveLength(240);
  });
  it('rises into an arc, drifts sideways, then fades away', () => {
    const start = damageNumberPose(.85), apex = damageNumberPose(.425), end = damageNumberPose(0);
    expect(apex.rise).toBeGreaterThan(start.rise); expect(apex.rise).toBeGreaterThan(end.rise);
    expect(end.offset).toBeGreaterThan(start.offset); expect(end.alpha).toBe(0);
    expect(damageNumberPose(.425, -1).offset).toBe(-apex.offset);
  });
});
describe('respawn camera', () => {
  it('pans from death to respawn in exactly 1.5 real seconds with smooth endpoints', () => {
    const pan = new RespawnCamera(); pan.start({ x: 10, y: 20 }, { x: 30, y: 50 });
    expect(pan.advance(0)).toEqual({ x: 10, y: 20 });
    expect(pan.advance(.75)).toEqual({ x: 20, y: 35 });
    expect(pan.advance(.75)).toEqual({ x: 30, y: 50 }); expect(pan.advance(.01)).toBeUndefined();
  });
  it('copies the endpoints and can cancel when a world changes', () => {
    const pan = new RespawnCamera(), to = { x: 30, y: 50 }; pan.start({ x: 10, y: 20 }, to); to.x = 100;
    expect(pan.advance(1.5)).toEqual({ x: 30, y: 50 });
    pan.start(to, to); pan.cancel(); expect(pan.advance(1)).toBeUndefined();
  });
});
