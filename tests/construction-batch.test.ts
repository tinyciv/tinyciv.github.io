import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStroke, constructionLine } from '../src/game/construction';
import { buildAt, withConstructionBatch } from '../src/game/simulation';
import * as builders from '../src/game/builders';
import * as archery from '../src/game/archery';
import type { GameState } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 32, height: 24, seed: 'batch', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 768 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5,
        food: 2, production: 0, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', x: 4, y: 8, faction: 0, hp: 650, maxHp: 650, capacity: 20, unhousedResidents: 20 },
      { id: 2, kind: 'road', x: 5, y: 6, faction: 0, hp: 100, maxHp: 100, capacity: 0 }],
    units: [{ id: 3, kind: 'leader', faction: 0, x: 10.5, y: 6.5, hp: 100, maxHp: 100, morale: 100,
      attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Roma', color: '#f00', affinity: 100, relation: 'self', food: 100, gold: 200,
      production: 0, population: 20, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    fields: [], time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'batch', rngState: 1,
  };
}
afterEach(() => vi.restoreAllMocks());

describe('construction stroke bookkeeping', () => {
  it('staffs a whole road stroke once while retaining per-cell payment and final city rates', () => {
    const state = fixture(), control = fixture(), line = constructionLine({ x: 6, y: 6 }, { x: 14, y: 6 });
    for (const p of line) expect(buildAt(control, 'road', p.x, p.y).ok).toBe(true);
    const staffing = vi.spyOn(builders, 'ensureBuilders'), training = vi.spyOn(archery, 'scheduleArcheryTraining');
    expect(buildStroke(state, 'road', line)).toMatchObject({ ok: true, placed: 9, skipped: 0 });
    expect(staffing).toHaveBeenCalledTimes(1); expect(training).toHaveBeenCalledTimes(1);
    expect(state.factions[0].gold).toBe(110);
    expect(state.factions[0].yields).toEqual(control.factions[0].yields);
    expect(state.units.filter(u => u.builder)).toHaveLength(control.units.filter(u => u.builder).length);
    expect(state.buildings.filter(b => b.construction)).toHaveLength(9);
    expect(buildAt(state, 'road', 15, 6).ok).toBe(true);
    expect(staffing).toHaveBeenCalledTimes(2); // No leaked batch on the next command.
  });

  it('reconciles the affordable prefix and does no work for a rejected stroke', () => {
    const state = fixture(); state.factions[0].gold = 25;
    const staffing = vi.spyOn(builders, 'ensureBuilders');
    expect(buildStroke(state, 'road', constructionLine({ x: 6, y: 6 }, { x: 10, y: 6 })))
      .toMatchObject({ ok: true, placed: 2, skipped: 3 });
    expect(state.factions[0].gold).toBe(5); expect(staffing).toHaveBeenCalledTimes(1);
    expect(buildStroke(state, 'road', [{ x: 8, y: 6 }]).placed).toBe(0);
    expect(staffing).toHaveBeenCalledTimes(1);
  });

  it('flushes successful nested orders even if a later caller throws', () => {
    const state = fixture(), staffing = vi.spyOn(builders, 'ensureBuilders');
    expect(() => withConstructionBatch(state, () => {
      withConstructionBatch(state, () => expect(buildAt(state, 'road', 6, 6).ok).toBe(true));
      expect(staffing).not.toHaveBeenCalled();
      throw new Error('interrupted');
    })).toThrow('interrupted');
    expect(staffing).toHaveBeenCalledTimes(1);
    expect(buildAt(state, 'road', 7, 6).ok).toBe(true);
    expect(staffing).toHaveBeenCalledTimes(2);
  });
});
