import { describe, expect, it } from 'vitest';
import { recordNativeFrame } from './helpers/native-renderer';
import type { GameState } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 16, height: 16, seed: 'wheat-walk', source: 'fixture', spawns: [],
      tiles: Array.from({ length: 256 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
        moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    units: [{ id: 1, kind: 'leader', faction: 0, x: 6.5, y: 6.5, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: 4, order: 'follow', cooldown: 0, lastCombat: -100,
      moving: true, facing: 0, attackTime: 0 }], buildings: [], factions: [],
    fields: [6, 7].flatMap(y => [6, 7].map(x => ({ id: y * 16 + x, camp: 50, faction: 0, x, y,
      planted: true, food: 0, nextHarvest: 0 }))),
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'wheat-walk', rngState: 1,
  };
}

describe('stable figures walking through wheat', () => {
  it.each([6.03, 6.5, 6.97, 7, 7.03, 7.5, 7.97, 8.03])('keeps native unit art at y=%s instead of rerasterizing its silhouette', y => {
    const state = fixture(); state.units[0].y = y;
    const { sprites } = recordNativeFrame(state);
    expect(sprites.filter(sprite => sprite.key === 'unit')).toHaveLength(1);
    expect(sprites.some(sprite => sprite.key.startsWith('masked:'))).toBe(false);
    if (y < 8) expect(sprites.some(sprite => sprite.key.startsWith('wheat-front:'))).toBe(true);
    else expect(sprites.some(sprite => sprite.key.startsWith('wheat-front:'))).toBe(false);
  });

  it('shares foreground pixels across fractional motion and animation frames', () => {
    const state = fixture(); state.units[0].y = 6.5001;
    const keys = () => recordNativeFrame(state).sprites.filter(sprite => sprite.key.startsWith('wheat-front:')).map(sprite => sprite.key);
    const before = keys();
    state.units[0].y = 6.5002; state.units[0].x += .0001; state.units[0].facing = Math.PI; state.time = 1;
    expect(keys()).toEqual(before);
  });
});
