import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { researchCost, researchStatus, prioritizeResearch, updateResearch, isBuildingUnlocked, areArchersUnlocked, areScoutsUnlocked, isInfantryDrillUnlocked, buildingResearchRequirement, RESEARCH_BRANCHES } from '../src/game/research';
import { grantIncome } from '../src/game/resource-income';
import { buildAt, validateBuildAt } from '../src/game/simulation';
import { buildStroke, constructionLine } from '../src/game/construction';
import { setArcherFraction, nextRecruitRole } from '../src/game/archery';
import { buildingActivityAvailable } from '../src/game/building-activity';
import { buildingHeight, buildingWidth, type Building } from '../src/game/types';
import { fixture, building, complete, points } from './helpers/research-income';

describe('income-funded technology unlocks', () => {
  it('keeps essentials and libraries available, with Fortification before Masonry', () => {
    const state = fixture(), faction = state.factions[0];
    for (const kind of ['house','well','bridge','road','palace','camp','library','palisade'] as const) expect(isBuildingUnlocked(faction, kind)).toBe(true);
    for (const kind of ['wall','woodenTower','guardPost','monument','blacksmith','archeryRange','irrigation','scoutLodge','healerShack'] as const) expect(isBuildingUnlocked(faction, kind)).toBe(false);
    expect(validateBuildAt(state, 'wall', 12, 10).message).toContain('Masonry');
    prioritizeResearch(state, state.buildings[1], 'wall');
    expect(researchStatus(state, 0)).toMatchObject({ focus: 'woodenTower', requestedFocus: 'wall' });
    points(state, researchCost(faction, 'woodenTower'));
    expect(isBuildingUnlocked(faction, 'guardPost')).toBe(true); expect(isBuildingUnlocked(faction, 'wall')).toBe(false);
    points(state, researchCost(faction, 'wall'));
    expect(validateBuildAt(state, 'wall', 12, 10).ok).toBe(true);
  });
  it('unlocks real irrigation placements and connected drag orders only when the points are earned', () => {
    const state = fixture(); state.world.tiles[9 * state.world.width + 12].terrain = 'river';
    expect(buildAt(state, 'irrigation', 12, 10).ok).toBe(false);
    prioritizeResearch(state, state.buildings[1], 'irrigation'); const required = researchStatus(state, 0).required;
    points(state, required - 1); expect(buildAt(state, 'irrigation', 12, 10).ok).toBe(false);
    updateResearch(state, 100000); expect(buildAt(state, 'irrigation', 12, 10).ok).toBe(false);
    points(state, 1); expect(buildAt(state, 'irrigation', 12, 10).ok).toBe(true);
    expect(buildStroke(state, 'irrigation', constructionLine({ x: 13, y: 10 }, { x: 15, y: 10 }))).toMatchObject({ placed: 3, skipped: 0 });
  });
  it.each([['scoutLodge','scoutLodge'],['healerShack','traditionalMedicine']] as const)('unlocks and constructs %s from research %s', (kind, tech) => {
    const state = fixture(); expect(buildAt(state, kind, 12, 10).ok).toBe(false); complete(state, tech);
    expect(buildAt(state, kind, 12, 10).ok).toBe(true); const structure = state.buildings.find(b => b.kind === kind)!;
    expect([buildingWidth(structure), buildingHeight(structure)]).toEqual([1,1]);
    expect(structure.construction).toMatchObject({ duration: 45, paidGold: kind === 'scoutLodge' ? 100 : 200 });
    expect(buildingActivityAvailable(state, structure)).toBe(false); delete structure.construction;
    if (kind === 'scoutLodge') expect(buildingActivityAvailable(state, structure)).toBe(true);
  });
  it('builds a 750HP two-by-two library with normal cost, work, and footprint validation', () => {
    const state = fixture(); entityStore(state).buildings.replace(state.buildings.slice(0,1));
    state.factions[0].gold = 199; expect(buildAt(state, 'library', 10,10).ok).toBe(false);
    state.factions[0].gold = 200; expect(buildAt(state, 'library', 10,10).ok).toBe(true);
    const library = state.buildings.find(b => b.kind === 'library')!;
    expect(library).toMatchObject({ maxHp: 750, construction: { duration: 90, paidGold: 200, waitingForBuilder: true } });
    expect([buildingWidth(library),buildingHeight(library)]).toEqual([2,2]);
    grantIncome(state.factions[0], { gold: 100 }, state); expect(state.factions[0].research).toBeUndefined(); expect(state.factions[0].gold).toBe(100);
    const blocked = fixture(); entityStore(blocked).buildings.replace([blocked.buildings[0], building(3,'wall',11,11)]);
    expect(buildAt(blocked,'library',10,10).ok).toBe(false);
  });
  it('unlocks archers, infantry drill and scouts through their entire prerequisite chains', () => {
    const state = fixture(), faction = state.factions[0], range = building(3,'archeryRange'); entityStore(state).buildings.add(range);
    faction.archerFraction=1; expect(setArcherFraction(state,range,1)).toBe(false); expect(nextRecruitRole(state,faction)).toBe('warrior');
    complete(state,'archeryRange'); expect(areArchersUnlocked(faction)).toBe(true); expect(setArcherFraction(state,range,1)).toBe(true); expect(nextRecruitRole(state,faction)).toBe('archer');
    complete(state,'infantryDrill'); expect(isInfantryDrillUnlocked(faction)).toBe(true); expect(faction.research?.levels).toMatchObject({ blacksmith:1, woodenTower:1, militaryTactics:1, infantryDrill:1 });
    complete(state,'scoutLodge'); expect(areScoutsUnlocked(faction)).toBe(true); expect(buildingResearchRequirement('guardPost')).toBe('woodenTower');
    expect(RESEARCH_BRANCHES).toHaveLength(21);
  });
});

describe('passive technology completion hooks', () => {
  it('immediately reinforces damaged existing defenses without healing their damage fraction or changing another owner', () => {
    const state = fixture(), faction = state.factions[0];
    state.factions.push({ ...faction, id: 1, relation: 'war' });
    const wall: Building = { ...building(20, 'wall', 12, 10), defenseBaseMaxHp: 225, hp: 900, maxHp: 2250 };
    const tower: Building = { ...building(21, 'woodenTower', 13, 10), hp: 300, maxHp: 600 };
    const enemy: Building = { ...building(22, 'wall', 24, 10, 1), defenseBaseMaxHp: 225, hp: 900, maxHp: 2250 };
    entityStore(state).buildings.add(wall, tower, enemy);
    faction.research = { focus: 'reinforcedDefenses', levels: { wall: 1, woodenTower: 1, blacksmith: 1, metalTools: 1 }, progress: {} };
    prioritizeResearch(state, state.buildings[1], faction.research!.focus);
    const duration = researchCost(faction, 'reinforcedDefenses');
    points(state, duration - 1);
    expect(wall).toMatchObject({ hp: 900, maxHp: 2250 });
    points(state, 1);
    expect(faction.research.levels.reinforcedDefenses).toBe(1);
    expect(wall).toMatchObject({ hp: 1170, maxHp: 2925 });
    expect(tower).toMatchObject({ hp: 390, maxHp: 780 });
    expect(wall.hp / wall.maxHp).toBeCloseTo(.4);
    expect(tower.hp / tower.maxHp).toBe(.5);
    expect(enemy).toMatchObject({ hp: 900, maxHp: 2250 });
    updateResearch(state, duration);
    expect(wall).toMatchObject({ hp: 1170, maxHp: 2925 });
  });

  it('immediately speeds the remaining construction work at Metal Tools completion, preserving work already done', () => {
    const state = fixture(), faction = state.factions[0];
    state.factions.push({ ...faction, id: 1, relation: 'peace' });
    const house: Building = { ...building(20, 'house', 12, 10), construction: { startedAt: 0, duration: 20 } };
    const other: Building = { ...building(21, 'house', 24, 10, 1), construction: { startedAt: 0, duration: 20 } };
    entityStore(state).buildings.add(house, other);
    faction.research = { focus: 'metalTools', levels: { woodenTower: 1, wall: 1, blacksmith: 1 }, progress: {} };
    prioritizeResearch(state, state.buildings[1], faction.research!.focus);
    const duration = researchCost(faction, 'metalTools');
    points(state, duration - 1);
    expect(house.construction).toMatchObject({ startedAt: 0, duration: 20 });
    state.time = 10;
    points(state, 1);
    expect(faction.research.levels.metalTools).toBe(1);
    expect(house.construction).toMatchObject({ startedAt: 2, duration: 16, researchSpeed: 1.25 });
    expect((state.time - house.construction!.startedAt) / house.construction!.duration).toBe(.5);
    expect(house.construction!.startedAt + house.construction!.duration - state.time).toBe(8);
    expect(other.construction).toEqual({ startedAt: 0, duration: 20 });
    updateResearch(state, duration);
    expect(house.construction).toMatchObject({ startedAt: 2, duration: 16 });
  });

  it('immediately adds one housing place to existing homes at Urban Planning completion, retaining tiers and reclaimed-lot bonuses', () => {
    const state = fixture(), faction = state.factions[0];
    state.factions.push({ ...faction, id: 1, relation: 'peace' });
    const basic: Building = { ...building(20, 'house', 12, 10), houseLevel: 1, capacity: 2 };
    const upgraded: Building = { ...building(21, 'house', 13, 10), houseLevel: 3, redevelopedFarm: true, capacity: 5 };
    const enemy: Building = { ...building(22, 'house', 24, 10, 1), houseLevel: 2, capacity: 3 };
    entityStore(state).buildings.add(basic, upgraded, enemy);
    faction.research = { focus: 'urbanPlanning', levels: { irrigation: 1, grainStorage: 1, monument: 1, scoutLodge: 1, sailing: 1, coinage: 1, woodenTower: 1, wall: 1, blacksmith: 1, metalTools: 1 }, progress: {} };
    prioritizeResearch(state, state.buildings[1], faction.research!.focus);
    const duration = researchCost(faction, 'urbanPlanning');
    points(state, duration - 1);
    expect([basic.capacity, upgraded.capacity, enemy.capacity]).toEqual([2, 5, 3]);
    points(state, 1);
    expect(faction.research.levels.urbanPlanning).toBe(1);
    expect([basic.capacity, upgraded.capacity, enemy.capacity]).toEqual([3, 6, 3]);
    expect(upgraded.houseLevel).toBe(3);
    updateResearch(state, duration);
    expect([basic.capacity, upgraded.capacity, enemy.capacity]).toEqual([3, 6, 3]);
  });
});
