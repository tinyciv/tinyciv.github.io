import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { buildingArmor } from '../src/game/defense-equipment';
import { updateDefenseResearch } from '../src/game/defense-research';
import { removeBuildings } from '../src/game/construction-cancellation';
import { queueConstruction, updateConstruction } from '../src/game/structures';
import { updateWallStats } from '../src/game/wall-stats';
import { markWorldChanged } from '../src/game/world-revisions';
import { updateGame } from '../src/game/simulation';
import type { Building, GameState } from '../src/game/types';

function fixture(): GameState {
  return {
    world: { width: 24, height: 24, seed: 'wall-strength', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 576 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) },
    buildings: [], units: [],
    factions: [{ id: 0, name: 'Roma', color: '#ee3434', affinity: 100, relation: 'self', food: 500, gold: 1000,
      production: 0, population: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'wall-strength', rngState: 1,
    marauderPacks: [], raiderCamps: [],
  };
}
function add(state: GameState, kind: Building['kind'], changes: Partial<Building> = {}): Building {
  const base = kind === 'woodenTower' ? 600 : kind === 'palisade' ? 56.25 : 225;
  const building: Building = { id: Math.max(0, ...state.buildings.map(b => b.id)) + 1, kind,
    x: 8, y: 8, faction: 0, maxHp: base, hp: base, armor: kind === 'woodenTower' ? 6 : 2, capacity: 0, ...changes };
  entityStore(state).buildings.add(building); return building;
}

describe('live stone fortification strength', () => {
  it('uses 10× wall and 5× gate health, preserves wounds, and restores solid-wall health after road cancellation', () => {
    const state = fixture(), wall = add(state, 'wall', { hp: 90 });
    updateWallStats(state);
    expect(wall).toMatchObject({ hp: 900, maxHp: 2250, defenseBaseMaxHp: 225 });
    expect(buildingArmor(wall, undefined)).toBe(3);
    const road = add(state, 'road'); queueConstruction(road, 0, 2, state);
    expect(wall).toMatchObject({ hp: 450, maxHp: 1125 });
    expect(buildingArmor(wall, undefined)).toBe(3);
    removeBuildings(state, new Set([road.id]));
    expect(wall).toMatchObject({ hp: 900, maxHp: 2250 });
  });

  it('grants wall-mounted towers health and armor and removes only those bonuses when support is demolished', () => {
    const state = fixture(), wall = add(state, 'wall'), tower = add(state, 'woodenTower', { hp: 240 });
    updateWallStats(state);
    expect(tower).toMatchObject({ hp: 2400, maxHp: 6000, armor: 6, defenseBaseMaxHp: 600 });
    expect(buildingArmor(tower, undefined)).toBe(9);
    removeBuildings(state, new Set([wall.id]));
    expect(tower).toMatchObject({ hp: 240, maxHp: 600 });
    expect(buildingArmor(tower, undefined)).toBe(6);
  });

  it.each(['palisade', 'foreign', 'dead', 'gate', 'queued'] as const)('does not give towers solid-stone support from a %s', kind => {
    const state = fixture(), wall = add(state, kind === 'palisade' ? 'palisade' : 'wall'), tower = add(state, 'woodenTower');
    if (kind === 'foreign') wall.faction = 1;
    if (kind === 'dead') wall.hp = 0;
    if (kind === 'gate') add(state, 'road');
    if (kind === 'queued') queueConstruction(wall, 0, 30, state);
    updateWallStats(state);
    expect(tower.maxHp).toBe(600); expect(buildingArmor(tower, undefined)).toBe(6);
    if (kind === 'dead') expect(wall.hp).toBe(0);
  });

  it('applies support when wall construction finishes and drops it when support dies', () => {
    const state = fixture(), wall = add(state, 'wall'), tower = add(state, 'woodenTower');
    wall.construction = { startedAt: 0, duration: 4, cleared: true };
    updateWallStats(state); expect(tower.maxHp).toBe(600);
    state.time = 4; updateConstruction(state);
    expect(wall.construction).toBeUndefined(); expect(tower.maxHp).toBe(6000);
    wall.hp = 0; updateWallStats(state, true);
    expect(tower.maxHp).toBe(600); expect(wall.hp).toBe(0);
  });

  it('composes research and equipment once and removes old-owner benefits when support ownership changes', () => {
    const state = fixture(), wall = add(state, 'wall', { hp: 112.5 }), tower = add(state, 'woodenTower', { hp: 300 });
    state.factions[0].armorLevel = 3;
    state.factions[0].research = { focus: 'reinforcedDefenses', levels: { reinforcedDefenses: 1 }, progress: {} };
    for (let i = 0; i < 4; i++) updateDefenseResearch(state);
    expect(wall).toMatchObject({ hp: 1462.5, maxHp: 2925, armor: 2 });
    expect(tower).toMatchObject({ hp: 3900, maxHp: 7800, armor: 6 });
    expect(buildingArmor(wall, state.factions[0])).toBe(4.5);
    expect(buildingArmor(tower, state.factions[0])).toBe(13.5);
    wall.faction = 1; markWorldChanged(state.world); updateWallStats(state);
    expect(wall).toMatchObject({ hp: 1125, maxHp: 2250 });
    expect(tower).toMatchObject({ hp: 390, maxHp: 780 });
    expect(buildingArmor(tower, state.factions[0])).toBe(9);
  });

  it('does not invalidate the world or compound maximum health on unchanged frames', () => {
    const state = fixture(), wall = add(state, 'wall'); add(state, 'woodenTower'); updateWallStats(state);
    const revision = state.world.revision;
    wall.hp -= 23;
    for (let frame = 0; frame < 300; frame++) updateWallStats(state);
    expect(state.world.revision).toBe(revision); expect(wall).toMatchObject({ hp: 2227, maxHp: 2250 });
  });

  it('refreshes existing defenses in a paused live session without advancing its clock', () => {
    const state = fixture(), wall = add(state, 'wall'), tower = add(state, 'woodenTower'); state.paused = true;
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(wall.maxHp).toBe(2250); expect(tower.maxHp).toBe(6000); expect(state.time).toBe(0);
  });
});
