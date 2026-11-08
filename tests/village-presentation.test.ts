import { describe, expect, it } from 'vitest';
import { buildingActivityAvailable, buildingActivityKind } from '../src/game/building-activity';
import { buildingKey } from '../src/game/native-art';
import { VILLAGE_TENT_RECT } from '../src/game/village-art';
import type { Building, GameState, NeutralVillage } from '../src/game/types';

function fixture(): { state: GameState; camp: Building; village: NeutralVillage } {
  const camp: Building = { id: 10, kind: 'villageTent', villageId: 1, faction: 4, x: 10, y: 10, hp: 350, maxHp: 350, capacity: 0 };
  const village: NeutralVillage = { id: 1, faction: 4, campId: camp.id, x: 10, y: 10, name: 'Willow tribe', identity: 'growers', relation: 'neutral',
    nextGrowthAt: 120, nextThinkAt: 0, nextRecruitAt: 120 };
  const state: GameState = {
    world: { width: 30, height: 30, seed: 'village-presentation', source: 'test', spawns: [], tiles: [] },
    units: [{ id: 1, kind: 'leader', faction: 0, hp: 100, x: 10.5, y: 14, morale: 100, attack: 25, defense: 5,
      speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    buildings: [camp], villages: [village], gameOver: false, factions: [], time: 0, tick: 0, paused: false, speed: 1,
    events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null, victory: false, seed: 'village-presentation', rngState: 1,
  };
  return { state, camp, village };
}

describe('native village presentation', () => {
  it('uses the original static Puny tent with no fire animation in the render cache', () => {
    const { camp } = fixture();
    expect(VILLAGE_TENT_RECT).toEqual([64, 416, 16, 16]);
    expect(buildingKey(camp, 0, '#ffffff')).toBe(buildingKey(camp, .25, '#ffffff'));
    expect(buildingKey(camp, 0, '#ffffff')).toBe(buildingKey(camp, .5, '#ffffff'));
  });

  it('opens a neutral village camp within three tiles without enabling ordinary enemy activity panels', () => {
    const { state, camp } = fixture();
    expect(buildingActivityKind(camp)).toBe('village');
    expect(buildingActivityAvailable(state, camp)).toBe(true);
    expect(buildingActivityAvailable(state, { ...camp, kind: 'guardPost', villageId: undefined })).toBe(false);
    expect(buildingActivityAvailable(state, { ...camp, id: 11 })).toBe(false);
    state.units[0].y = 14.01;
    expect(buildingActivityAvailable(state, camp)).toBe(false);
  });

  it('keeps the camp available for diplomacy in each living relationship and closes it after destruction', () => {
    const { state, camp, village } = fixture();
    for (const relation of ['neutral', 'trade', 'allied', 'war'] as const) {
      village.relation = relation;
      expect(buildingActivityAvailable(state, camp)).toBe(true);
    }
    village.destroyed = true;
    expect(buildingActivityAvailable(state, camp)).toBe(false);
    delete village.destroyed;
    camp.hp = 0;
    expect(buildingActivityAvailable(state, camp)).toBe(false);
  });
});
