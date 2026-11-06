import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { citySummaries } from '../src/game/cities';
import { houseCapacity, housingGoldBonus, updateWellUpgrades } from '../src/game/wells';
import { nativeHouseTier } from '../src/game/puny-building-art';
import { houseBirthProgress, isHouseEnclosed } from '../src/game/enclosures';
import type { Building, GameState, Unit } from '../src/game/types';

const building = (id: number, kind: Building['kind'], x: number, y: number, extra: Partial<Building> = {}): Building => ({
  id, kind, x, y, faction: 0, hp: 150, maxHp: 200, capacity: 0, ...extra,
});
function fixture(): GameState {
  const houses = Array.from({ length: 20 }, (_, i) => building(10 + i, 'house', 10 + i % 4, 10 + Math.floor(i / 4),
    { capacity: 3, residents: 2, houseLevel: 2, houseStyle: 'hovel' }));
  return { world: { width: 48, height: 30, seed: 'housing-three', source: 'test', spawns: [],
    tiles: Array.from({ length: 48 * 30 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6,
      food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 7, 8), building(2, 'guardPost', 9, 11), building(3, 'well', 10, 9), ...houses], units: [], fields: [],
    factions: [{ id: 0, name: 'Roma', color: '#f34f59', affinity: 100, relation: 'self', food: 500, gold: 500,
      production: 0, population: 40, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'housing-three', rngState: 1 };
}
const home = (state: GameState) => state.buildings.find(building => building.id === 10)!;
function enclose(state: GameState): Building[] {
  const walls: Building[] = [];
  let id = 100;
  for (let y = 7; y <= 15; y++) for (let x = 6; x <= 15; x++)
    if (x === 6 || x === 15 || y === 7 || y === 15) walls.push(building(id++, 'wall', x, y));
  entityStore(state).buildings.add(...walls);
  return walls;
}

describe('level-three city housing', () => {
  it('requires forty actual nearby residents, a well and a completed guard post in the same city borders', () => {
    const state = fixture(), house = home(state);
    updateWellUpgrades(state);
    expect(house).toMatchObject({ houseLevel: 3, capacity: 4, hp: 150, maxHp: 200, houseStyle: 'cottage' });
    expect(nativeHouseTier(house)).toBe(3);
    expect(house.houseDowngradeAt).toBeUndefined();
    expect(housingGoldBonus(state, 0)).toBe(20);
    expect(citySummaries(state)[0]).toMatchObject({ population: 40, housing: 80, gold: 42 });
  });

  it.each(['population', 'vacancy', 'well', 'unfinished post', 'enemy post', 'remote post'] as const)('does not upgrade when the missing requirement is %s', missing => {
    const state = fixture();
    if (missing === 'population') state.factions[0].population = 39;
    if (missing === 'vacancy') for (const house of state.buildings.filter(building => building.kind === 'house')) house.residents = 1;
    if (missing === 'well') state.buildings[2].hp = 0;
    if (missing === 'unfinished post') state.buildings[1].construction = { startedAt: 0, duration: 30 };
    if (missing === 'enemy post') state.buildings[1].faction = 1;
    if (missing === 'remote post') { state.buildings[1].x = 40; state.buildings[1].y = 20; }
    updateWellUpgrades(state);
    expect(home(state).houseLevel).toBe(2);
  });

  it('counts only residents within six tiles and excludes living soldiers and another city’s post', () => {
    const state = fixture(), target = home(state);
    state.buildings.find(building => building.id === 17)!.x = target.x + 7;
    updateWellUpgrades(state); expect(target.houseLevel).toBe(2);
    state.buildings.find(building => building.id === 17)!.x = target.x + 6;
    state.buildings.find(building => building.id === 17)!.y = target.y;
    updateWellUpgrades(state); expect(target.houseLevel).toBe(3);
    const second = building(100, 'palace', 38, 20);
    entityStore(state).buildings.add(second); state.buildings[1].x = 40; state.buildings[1].y = 20;
    state.time = 1; updateWellUpgrades(state);
    expect(target.houseDowngradeAt).toBe(61);
  });

  it('warns for a full minute, cancels the warning after recovery, then downgrades without changing health', () => {
    const state = fixture(), target = home(state); updateWellUpgrades(state);
    state.factions[0].population = 39; state.time = 5; updateWellUpgrades(state);
    expect(target.houseDowngradeAt).toBe(65); expect(target.houseLevel).toBe(3);
    state.time = 64.99; updateWellUpgrades(state); expect(target.houseLevel).toBe(3);
    state.factions[0].population = 40; updateWellUpgrades(state); expect(target.houseDowngradeAt).toBeUndefined();
    state.buildings[2].hp = 0; state.time = 70; updateWellUpgrades(state);
    expect(target.houseDowngradeAt).toBe(130);
    state.time = 130; updateWellUpgrades(state);
    expect(target).toMatchObject({ houseLevel: 2, capacity: 3, hp: 150, maxHp: 200 });
    expect(target.houseDowngradeAt).toBeUndefined(); expect(housingGoldBonus(state, 0)).toBe(0);
  });

  it('keeps the permanent farm-redevelopment bed and only taxes actual resident population', () => {
    const state = fixture(), target = home(state); target.redevelopedFarm = true;
    updateWellUpgrades(state);
    expect(houseCapacity(target)).toBe(5);
    target.residents = 5;
    expect(housingGoldBonus(state, 0)).toBe(20); // The realm still has forty people, not forty-five.
    state.time = 10; state.buildings[1].hp = 0; updateWellUpgrades(state);
    state.time = 70; updateWellUpgrades(state); expect(houseCapacity(target)).toBe(4);
  });
});

describe('level-four protected city housing', () => {
  it('earns the chimney house only with the same protection that grants the growth bonus', () => {
    const state = fixture(), target = home(state);
    updateWellUpgrades(state);
    expect(target.houseLevel).toBe(3);
    expect(houseBirthProgress(state, target)).toBe(1);
    enclose(state); updateWellUpgrades(state);
    expect(target).toMatchObject({ houseLevel: 4, houseStyle: 'villa', capacity: 5, hp: 150, maxHp: 200 });
    expect(nativeHouseTier(target)).toBe(4);
    expect(houseBirthProgress(state, target)).toBeCloseTo(1 / 1.3);
    expect(citySummaries(state)[0]).toMatchObject({ population: 40, housing: 100, gold: 42 });
    updateWellUpgrades(state);
    expect(target.capacity).toBe(5);
  });

  it.each(['population', 'well', 'guard post'] as const)('still requires level-three eligibility when missing %s', missing => {
    const state = fixture(); enclose(state);
    if (missing === 'population') state.factions[0].population = 39;
    if (missing === 'well') state.buildings[2].hp = 0;
    if (missing === 'guard post') state.buildings[1].construction = { startedAt: 0, duration: 30 };
    expect(isHouseEnclosed(state, home(state))).toBe(true);
    updateWellUpgrades(state);
    expect(home(state).houseLevel).toBe(2);
  });

  it('does not give an outdoor house its protected city’s level-four status', () => {
    const state = fixture(); enclose(state);
    const outside = building(400, 'house', 16, 10, { houseLevel: 2, capacity: 3, residents: 2 });
    entityStore(state).buildings.add(outside); state.factions[0].population = 62;
    for (const house of state.buildings.filter(house => house.kind === 'house' && house !== outside)) house.residents = 3;
    updateWellUpgrades(state);
    expect(home(state).houseLevel).toBe(4);
    expect(outside.houseLevel).toBe(3);
    expect(houseBirthProgress(state, outside)).toBe(1);
  });

  it('warns on a breach, cancels after repairs, and returns to level three after an unrepaired breach', () => {
    const state = fixture(), target = home(state), walls = enclose(state);
    const wall = walls.find(wall => wall.x === 6 && wall.y === 11)!;
    updateWellUpgrades(state);
    wall.hp = 0; state.time = 5; updateWellUpgrades(state);
    expect(houseBirthProgress(state, target)).toBe(1);
    expect(target).toMatchObject({ houseLevel: 4, capacity: 5, houseDowngradeAt: 65 });
    state.time = 64.99; updateWellUpgrades(state); expect(target.houseLevel).toBe(4);
    wall.hp = 100; updateWellUpgrades(state); expect(target.houseDowngradeAt).toBeUndefined();
    wall.hp = 0; state.time = 70; updateWellUpgrades(state);
    expect(target.houseDowngradeAt).toBe(130);
    state.time = 130; updateWellUpgrades(state);
    expect(target).toMatchObject({ houseLevel: 3, houseStyle: 'cottage', capacity: 4, hp: 150, maxHp: 200 });
    expect(target.houseDowngradeAt).toBeUndefined();
    wall.hp = 100; updateWellUpgrades(state);
    expect(target.houseLevel).toBe(4);
  });

  it('uses the same live-intruder check as the growth bonus even when no walls change', () => {
    const state = fixture(), target = home(state); enclose(state);
    updateWellUpgrades(state);
    const intruder: Unit = { id: 900, kind: 'warrior', faction: -2, x: 11.5, y: 11.5,
      hp: 65, maxHp: 65, attack: 10, defense: 2, morale: 100, speed: 2.35, range: 1.1,
      order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
    entityStore(state).units.add(intruder); state.time = 1; updateWellUpgrades(state);
    expect(target.houseDowngradeAt).toBe(61);
    expect(houseBirthProgress(state, target)).toBe(1);
    intruder.hp = 0; state.time = 2; updateWellUpgrades(state);
    expect(target.houseDowngradeAt).toBeUndefined();
    expect(target.houseLevel).toBe(4);
    expect(houseBirthProgress(state, target)).toBeCloseTo(1 / 1.3);
  });

  it('falls back to level two if a level-three requirement is also lost, keeping earned housing bonuses', () => {
    const state = fixture(), target = home(state); enclose(state);
    target.redevelopedFarm = true;
    state.factions[0].research = { focus: 'urbanPlanning', levels: { urbanPlanning: 1 }, progress: {} };
    updateWellUpgrades(state); expect(target.capacity).toBe(7);
    state.buildings[2].hp = 0; state.time = 10; updateWellUpgrades(state);
    expect(target.houseDowngradeAt).toBe(70);
    state.time = 70; updateWellUpgrades(state);
    expect(target).toMatchObject({ houseLevel: 2, capacity: 5, hp: 150, maxHp: 200 });
    expect(target.houseDowngradeAt).toBeUndefined();
  });

  it('supports friendly gates and applies the same earned tier to an opposing city', () => {
    const state = fixture(); enclose(state);
    entityStore(state).buildings.add(building(400, 'road', 6, 11));
    state.factions[0] = { ...state.factions[0], id: 1, relation: 'war' };
    for (const structure of state.buildings) structure.faction = 1;
    updateWellUpgrades(state);
    expect(home(state)).toMatchObject({ houseLevel: 4, capacity: 5 });
    expect(houseBirthProgress(state, home(state))).toBeCloseTo(1 / 1.3);
  });
});
