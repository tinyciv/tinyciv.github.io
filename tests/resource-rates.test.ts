import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/game/types';
import { grantIncome, recordIncome } from '../src/game/resource-income';
import { resourceChanges } from '../src/ui/resource-rates';

function fixture(time = 0): GameState {
  return { time, buildings: [], units: [], world: { width: 1, height: 1, tiles: [] }, factions: [{ id: 0, name: 'Roma', color: '#f34f59', affinity: 100, relation: 'self',
    food: 100, gold: 500, culture: 20, production: 0, population: 20,
    yields: { food: 99, gold: 999, production: 0 }, nextRaid: Infinity, defeated: false }] } as unknown as GameState;
}
const zero = { food: 0, gold: 0, culture: 0, elapsedSeconds: 0 };

describe('gross resource income over thirty game seconds', () => {
  it('excludes initial wealth and forecasts, and reports actual receipts without extrapolation', () => {
    const state = fixture(120), player = state.factions[0];
    expect(resourceChanges(state)).toEqual(zero);
    state.time = 125; grantIncome(player, { food: 3, gold: 10, culture: 2 }, state);
    expect(resourceChanges(state)).toEqual({ food: 3, gold: 10, culture: 2, elapsedSeconds: 5 });
    player.yields = { food: -5000, gold: 100000, production: 0 };
    expect(resourceChanges(state).gold).toBe(10);
    expect(player).toMatchObject({ food: 103, gold: 510, culture: 22 });
  });

  it('counts all earnings even when purchases, consumption and refunds happen before the next UI frame', () => {
    const state = fixture(), player = state.factions[0]; resourceChanges(state);
    player.gold -= 400; player.food -= 80;
    grantIncome(player, { gold: 20, food: 5 }, state);
    player.gold += 100; // Cancellation refund is not income.
    grantIncome(player, { gold: 8, food: 12 }, state);
    player.gold -= 50; player.food -= 4;
    const expected = { food: 17, gold: 28, culture: 0, elapsedSeconds: 0 };
    for (let frame = 0; frame < 1000; frame++) expect(resourceChanges(state)).toEqual(expected);
  });

  it('records gross taxes separately from same-tick maintenance without changing the balance twice', () => {
    const state = fixture(), player = state.factions[0]; resourceChanges(state);
    player.gold += 30 - 55;
    recordIncome(player, { gold: 30 });
    expect(player.gold).toBe(475); expect(resourceChanges(state).gold).toBe(30);
  });

  it('expires each receipt from the rolling window, unaffected by later spending', () => {
    const state = fixture(), player = state.factions[0]; resourceChanges(state);
    state.time = 5; grantIncome(player, { gold: 20 }, state); resourceChanges(state);
    state.time = 10; grantIncome(player, { gold: 80, food: 30, culture: 6 }, state); resourceChanges(state);
    state.time = 30; player.gold -= 300;
    expect(resourceChanges(state)).toEqual({ food: 30, gold: 100, culture: 6, elapsedSeconds: 30 });
    state.time = 35; expect(resourceChanges(state).gold).toBe(80);
    state.time = 40; expect(resourceChanges(state)).toEqual({ ...zero, elapsedSeconds: 30 });
  });

  it('keeps fractional receipts immediate between samples and resets after time rewinds', () => {
    const state = fixture(100), player = state.factions[0]; resourceChanges(state);
    state.time = 100.04; grantIncome(player, { food: .49, gold: .125, culture: .2 }, state);
    expect(resourceChanges(state).gold).toBe(.125);
    state.time = 100.02; expect(resourceChanges(state)).toEqual(zero);
    grantIncome(player, { gold: 5 }, state); expect(resourceChanges(state).gold).toBe(5);
  });

  it('isolates new games, finds the player by id, and clears missing-player history', () => {
    const state = fixture(), player = state.factions[0];
    state.factions.unshift({ ...player, id: 2, gold: 10000, relation: 'war' });
    resourceChanges(state); grantIncome(player, { gold: 3 }, state); grantIncome(state.factions[0], { gold: 1000 }, state);
    expect(resourceChanges(state).gold).toBe(3);
    expect(resourceChanges(fixture())).toEqual(zero);
    state.factions.splice(1, 1); expect(resourceChanges(state)).toEqual(zero);
    state.factions.push(player); expect(resourceChanges(state)).toEqual(zero);
  });

  it('keeps a bounded rolling window through many high-frame-rate ring wraps', () => {
    const state = fixture(), player = state.factions[0]; resourceChanges(state);
    for (let frame = 1; frame <= 120 * 120; frame++) {
      state.time = frame / 120;
      grantIncome(player, { food: 1 / 120, gold: 2 / 120, culture: .5 / 120 }, state);
      player.food -= 1 / 120; player.gold -= 3 / 120;
      const changes = resourceChanges(state);
      if (frame % 120 || state.time < 30) continue;
      expect(changes.food).toBeGreaterThanOrEqual(30 - 1e-8);
      expect(changes.food).toBeLessThanOrEqual(30.1 + 1e-8);
      expect(changes.gold).toBeCloseTo(changes.food * 2);
      expect(changes.culture).toBeCloseTo(changes.food / 2);
    }
    state.time += 31; expect(resourceChanges(state)).toEqual({ ...zero, elapsedSeconds: 30 });
  });
});
