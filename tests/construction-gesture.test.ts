import { describe, expect, it, vi } from 'vitest';
import { ConstructionGestureCache } from '../src/game/construction-gesture';
import { CHECK_INTERVAL_MS } from '../src/game/work-cadence';
import type { ConstructionPlan } from '../src/game/construction';
import type { GameState, Point } from '../src/game/types';

const state = () => ({ world: { tiles: [] }, factions: [{ gold: 100 }] }) as unknown as GameState;
const quote = (game: GameState, _kind: unknown, _from: Point, to: Point) => {
  const cost = 35, ok = game.factions[0].gold >= cost;
  const plan: ConstructionPlan = { ok, message: ok ? '' : 'Need 35 gold.', tiles: ok ? [to] : [],
    cells: [{ ...to, ok, existing: false, message: '' }], skipped: Number(!ok), cost: ok ? cost : 0,
    costs: { gold: ok ? cost : 0, food: 0, production: 0 } };
  return { points: [to], plan };
};

describe('shared construction gesture', () => {
  it('shares a quote across the HUD, renderer and same-tile movement, then refreshes stationary feedback', () => {
    const resolve = vi.fn(quote), cache = new ConstructionGestureCache(resolve), game = state();
    const first = cache.read(game, 'irrigation', { x: 1, y: 1 }, { x: 2.1, y: 1 }, 0);
    expect(cache.read(game, 'irrigation', { x: 1, y: 1 }, { x: 2.9, y: 1 }, 5)).toBe(first);
    expect(cache.read(game, 'irrigation', { x: 1, y: 1 }, { x: 2, y: 1 }, 20)).toBe(first);
    expect(resolve).toHaveBeenCalledTimes(1);
    game.factions[0].gold = 0;
    const refreshed = cache.read(game, 'irrigation', { x: 1, y: 1 }, { x: 2, y: 1 }, CHECK_INTERVAL_MS);
    expect(refreshed.plan.ok).toBe(false);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('flushes the latest endpoint and treasury on release inside the refresh interval', () => {
    const resolve = vi.fn(quote), cache = new ConstructionGestureCache(resolve), game = state();
    cache.read(game, 'road', { x: 1, y: 1 }, { x: 2, y: 1 }, 0);
    game.factions[0].gold = 0;
    const released = cache.read(game, 'road', { x: 1, y: 1 }, { x: 3.9, y: 1 }, 1, true);
    expect(released.requestedEnd).toEqual({ x: 3, y: 1 });
    expect(released.plan.ok).toBe(false);
    expect(resolve).toHaveBeenLastCalledWith(game, 'road', { x: 1, y: 1 }, { x: 3, y: 1 }, false);
    game.factions[0].gold = 100;
    expect(cache.read(game, 'road', { x: 1, y: 1 }, { x: 3.9, y: 1 }, 2, true).plan.ok).toBe(true);
  });

  it('does not carry a quote across a replacement world, game, tool, or cancelled gesture', () => {
    const resolve = vi.fn(quote), cache = new ConstructionGestureCache(resolve), game = state(), point = { x: 1, y: 1 };
    const read = () => cache.read(game, 'road', point, point, 0);
    const first = read(); game.world = { ...game.world };
    expect(read()).not.toBe(first);
    const next = read(); game.world.tiles = [];
    expect(read()).not.toBe(next);
    cache.read(game, 'irrigation', point, point, 0);
    cache.clear(); cache.read(game, 'irrigation', point, point, 0);
    cache.read({ ...game }, 'irrigation', point, point, 0);
    expect(resolve).toHaveBeenCalledTimes(6);
  });
});
