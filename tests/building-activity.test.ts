import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { buildingActivityAnchor, buildingActivityAvailable } from '../src/game/building-activity';
import { activityPopupLayout } from '../src/ui/building-activity';
import { type Building, type GameState } from '../src/game/types';

function fixture(): { state: GameState; palace: Building } {
  const palace: Building = { id: 2, kind: 'palace', x: 10, y: 10, faction: 0, hp: 650, maxHp: 650, capacity: 0 };
  const state: GameState = {
    world: { width: 30, height: 30, seed: 'activity', source: 'test', spawns: [], tiles: [] },
    units: [{ id: 1, kind: 'leader', faction: 0, x: 11, y: 15, hp: 100, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    buildings: [palace], factions: [], time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'activity', rngState: 1,
  };
  return { state, palace };
}

describe('building activity availability', () => {
  it('uses a three-tile radius from the footing rather than the palace origin', () => {
    const { state, palace } = fixture(), leader = state.units[0];
    for (const [x, y] of [[7, 11], [15, 11], [11, 7], [11, 15], [12 + 3 / Math.SQRT2, 12 + 3 / Math.SQRT2]]) {
      Object.assign(leader, { x, y }); expect(buildingActivityAvailable(state, palace)).toBe(true);
    }
    for (const [x, y] of [[6.99, 11], [15.01, 11], [9 - 3 / Math.SQRT2, 9 - 3 / Math.SQRT2]]) {
      Object.assign(leader, { x, y }); expect(buildingActivityAvailable(state, palace)).toBe(false);
    }
    expect(buildingActivityAnchor(palace)).toEqual({ x: 11, y: 10 });
  });

  it('requires an active Leader and a completed player building with an activity', () => {
    const { state, palace } = fixture();
    expect(buildingActivityAvailable(state, palace)).toBe(true);
    for (const change of [{ hp: 0 }, { faction: 1 }, { kind: 'house' as const }, { construction: { startedAt: 0, duration: 20 } }]) {
      expect(buildingActivityAvailable(state, { ...palace, ...change })).toBe(false);
    }
    state.units[0].hp = 0; expect(buildingActivityAvailable(state, palace)).toBe(false);
    state.units[0].hp = 100; state.gameOver = true; expect(buildingActivityAvailable(state, palace)).toBe(false);
  });

  it('measures smithy activity range from its one-tile footing', () => {
    const { state, palace } = fixture(), smithy: Building = { ...palace, kind: 'blacksmith' };
    entityStore(state).buildings.replace([smithy]);
    Object.assign(state.units[0], { x: 14, y: 10.5 });
    expect(buildingActivityAvailable(state, smithy)).toBe(true);
    expect(buildingActivityAnchor(smithy)).toEqual({ x: 10.5, y: 10 });
    state.units[0].x += .01;
    expect(buildingActivityAvailable(state, smithy)).toBe(false);
  });
});

describe('building popup placement', () => {
  it.each([[1440, 900], [800, 600], [390, 844], [320, 480], [844, 390]])('keeps text at native size on a %i × %i screen', (width, height) => {
    const panel = { width: 212, height: 114 }, viewport = { width, height };
    const layout = activityPopupLayout({ x: width / 2, y: height / 2 }, viewport, panel);
    expect(layout.scale).toBe(1);
    expect(layout.top + panel.height).toBeCloseTo(height / 2 - 16);
    expect(layout.left + panel.width * layout.scale / 2).toBeCloseTo(width / 2);
    expect(layout.visible).toBe(true);
    expect(Number.isInteger(layout.left)).toBe(true);
    expect(Number.isInteger(layout.top)).toBe(true);
  });

  it('keeps edge panels on screen and hides an offscreen building panel', () => {
    const viewport = { width: 390, height: 844 }, panel = { width: 212, height: 114 };
    for (const x of [0, 390]) {
      const layout = activityPopupLayout({ x, y: 500 }, viewport, panel);
      expect(layout.left).toBeGreaterThanOrEqual(8);
      expect(layout.left + panel.width * layout.scale).toBeLessThanOrEqual(382);
    }
    expect(activityPopupLayout({ x: -1, y: 200 }, viewport, panel).visible).toBe(false);
  });

  it('keeps the taller smithy panel readable and inside a compact screen', () => {
    const panel = { width: 258, height: 170 }, viewport = { width: 320, height: 480 };
    const layout = activityPopupLayout({ x: 24, y: 220 }, viewport, panel);
    expect(layout.scale).toBe(1);
    expect(layout.left).toBeGreaterThanOrEqual(20);
    expect(layout.top).toBeGreaterThanOrEqual(48);
    expect(layout.left + panel.width).toBeLessThanOrEqual(viewport.width - 20);
    expect(layout.top + panel.height).toBeLessThanOrEqual(viewport.height - 24);
  });

  it('positions CSS-constrained scrollable panels without fractional scaling', () => {
    const viewport = { width: 320, height: 480 }, panel = { width: 300, height: 600 };
    const layout = activityPopupLayout({ x: 300.3, y: 479.7 }, viewport, panel);
    expect(layout).toEqual({ left: 20, top: 48, scale: 1, visible: true });
  });
});
