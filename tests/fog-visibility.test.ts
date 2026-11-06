import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { beginFogFrame, endFogFrame, humanVisibilityViews, pointInSight, updateFog } from '../src/game/fog';
import { scoutRealm } from './helpers/scouts';

describe('visibility-only simulation fog reads', () => {
  it('keeps building/field memory unchanged until an ordinary fog update in the same frame', () => {
    const state = scoutRealm();
    const house = { id: 500, kind: 'house' as const, faction: 1, x: 17, y: 11, hp: 100, maxHp: 100, capacity: 4 };
    entityStore(state).buildings.add(house);
    state.fields = [{ id: 501, faction: 1, camp: 500, x: 18, y: 11, planted: true, food: 3, nextHarvest: 30 }];
    updateFog(state);
    const buildings = state.fog!.buildings, fields = state.fog!.fields;
    state.time += .1; house.hp = 75; state.fields[0].food = 9;
    beginFogFrame(state);
    try {
      expect(pointInSight(humanVisibilityViews(state)[0], 17.5, 11.5)).toBe(true);
      humanVisibilityViews(state);
      expect(state.fog!.buildings).toBe(buildings); expect(state.fog!.fields).toBe(fields);
      expect(buildings!.find(building => building.id === 500)!.hp).toBe(100);
      expect(fields![0].food).toBe(3);
      // A visibility cache hit must not suppress the subsequent memory commit.
      updateFog(state);
      expect(state.fog!.buildings!.find(building => building.id === 500)!.hp).toBe(75);
      expect(state.fog!.fields![0].food).toBe(9);
      const committed = state.fog!.buildings;
      humanVisibilityViews(state); updateFog(state);
      expect(state.fog!.buildings).toBe(committed);
    } finally { endFogFrame(state); }
  });

  it('refreshes moving sight immediately without copying newly discovered buildings', () => {
    const state = scoutRealm(); entityStore(state).units.replace([state.units[0]]); entityStore(state).buildings.replace([]);
    const target = { id: 500, kind: 'house' as const, faction: 1, x: 36, y: 24, hp: 100, maxHp: 100, capacity: 4 };
    entityStore(state).buildings.add(target);
    expect(pointInSight(humanVisibilityViews(state)[0], 36.5, 24.5)).toBe(false);
    state.units[0].x = 32.5; state.units[0].y = 24.5; state.time += .1;
    expect(pointInSight(humanVisibilityViews(state)[0], 36.5, 24.5)).toBe(true);
    expect(state.fog!.buildings).toEqual([]);
    expect(updateFog(state).buildings.some(building => building.id === target.id)).toBe(true);
  });
});
