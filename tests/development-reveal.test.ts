import { describe, expect, it } from 'vitest';
import { riverFixture, fixtureBuilding } from './helpers/river';
import { entityStore } from '../src/game/entity-store';
import { entityVisible, fogRenderMask, humanVisibilityViews, isMapRevealed, isVisible, presentationFog, setMapRevealed, updateFog } from '../src/game/fog';

describe('development Reveal map', () => {
  it('reveals all terrain and live enemy construction without changing exploration or hidden spawn eligibility', () => {
    const state = riverFixture();
    const distant = { ...fixtureBuilding(777, 'house', 37, 25, 1), construction: { startedAt: 0, duration: 30, waitingForBuilder: true } };
    entityStore(state).buildings.add(distant);
    const normal = updateFog(state), explored = [...normal.explored], buildings = [...normal.buildings];
    expect(isVisible(state, 37, 25)).toBe(false);
    setMapRevealed(state, true);
    const revealed = presentationFog(state);
    expect(revealed.visible.every(Boolean)).toBe(true);
    expect(revealed.explored.every(Boolean)).toBe(true);
    expect(revealed.buildings).toContain(distant);
    expect(entityVisible(state, distant)).toBe(true);
    expect(isVisible(state, 37, 25)).toBe(true);
    expect(fogRenderMask(revealed).alpha.every(alpha => alpha === 0)).toBe(true);
    expect(humanVisibilityViews(state)[0].visible[25 * 40 + 37]).toBe(0);
    expect(state.fog!.explored).toEqual(explored);
    setMapRevealed(state, false);
    expect(isMapRevealed(state)).toBe(false);
    expect(presentationFog(state).explored).toEqual(explored);
    expect(presentationFog(state).buildings).toEqual(buildings);
    expect(entityVisible(state, distant)).toBe(false);
    expect(isMapRevealed(riverFixture())).toBe(false);
  });
});
