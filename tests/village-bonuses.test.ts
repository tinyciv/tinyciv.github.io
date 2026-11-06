import { describe, expect, it } from 'vitest';
import { fieldHarvestFoodForState } from '../src/game/farms';
import { updateResearch } from '../src/game/research';
import { grantIncome } from '../src/game/resource-income';
import { researchStatus } from '../src/game/research';
import { queueConstruction, updateConstruction } from '../src/game/structures';
import { domesticTradePayout, updateMerchant, updateTradeRoutes } from '../src/game/trade';
import { refreshVillageBonuses, updateVillages } from '../src/game/villages';
import type { GameState, VillageIdentity } from '../src/game/types';

function fixture(identity: VillageIdentity): GameState {
  const state: GameState = {
    world: { width: 48, height: 32, seed: 'village-bonuses', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) },
    buildings: [
      { id: 1, kind: 'palace', faction: 0, x: 6, y: 10, hp: 650, maxHp: 650, capacity: 0 },
      { id: 2, kind: 'palace', faction: 0, x: 32, y: 10, hp: 650, maxHp: 650, capacity: 0 },
      { id: 3, kind: 'villageTent', faction: 1, villageId: 1, x: 24, y: 24, hp: 500, maxHp: 500, capacity: 0 },
      { id: 4, kind: 'library', faction: 0, x: 9, y: 10, hp: 500, maxHp: 500, capacity: 0 },
      { id: 5, kind: 'house', faction: 0, x: 6, y: 7, hp: 160, maxHp: 160, capacity: 4 },
    ], units: [], fields: [],
    factions: [{ id: 0, name: 'Roma', color: '#c44', relation: 'self', affinity: 100, food: 500, gold: 1000, population: 20,
      production: 0, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false,
      research: { focus: 'wall', priorities: ['wall'], allocation: .25, levels: { woodenTower: 1 }, progress: {} } }],
    villages: [{ id: 1, faction: 1, campId: 3, x: 24, y: 24, identity, name: 'Ally', relation: 'allied', nextGrowthAt: 9999, nextRecruitAt: 9999, nextThinkAt: 9999 }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: 'village-bonuses', rngState: 1,
  };
  refreshVillageBonuses(state);
  return state;
}
function destroyCamp(state: GameState): void {
  state.buildings.find(b => b.kind === 'villageTent')!.hp = 0;
  updateVillages(state);
}

describe('living village alliances affect the faction economy', () => {
  it('increases harvests at distant cities and removes the increase when the camp falls', () => {
    const state = fixture('growers');
    const base = fieldHarvestFoodForState({ ...state, factions: [{ ...state.factions[0], villageBonuses: undefined }] }, 10, 8, 0);
    expect(fieldHarvestFoodForState(state, 10, 8, 0)).toBeCloseTo(base * 1.1);
    expect(fieldHarvestFoodForState(state, 34, 8, 0)).toBeCloseTo(base * 1.1);
    destroyCamp(state);
    expect(fieldHarvestFoodForState(state, 34, 8, 0)).toBeCloseTo(base);
  });

  it('reduces research requirements without creating free RP, reverting after camp destruction', () => {
    const state = fixture('scholars');
    const discounted = researchStatus(state, 0).branches.find(branch => branch.id === 'wall')!.required;
    grantIncome(state.factions[0], { gold: 4 }, state); updateResearch(state,30);
    expect(state.factions[0].research!.progress.wall).toBeCloseTo(1);
    destroyCamp(state); grantIncome(state.factions[0], { gold: 4 }, state); updateResearch(state,30);
    expect(state.factions[0].research!.progress.wall).toBeCloseTo(2);
    expect(researchStatus(state, 0).branches.find(branch => branch.id === 'wall')!.required).toBeCloseTo(discounted * 1.15);
  });

  it('speeds construction without giving free progress and restores its duration after camp destruction', () => {
    const state = fixture('builders'), house = state.buildings.find(b => b.kind === 'house')!;
    queueConstruction(house, 0, 125); updateConstruction(state);
    expect(house.construction!.duration).toBeCloseTo((40 / 3) / 1.15);
    expect(house.construction!.waitingForBuilder).toBe(true);
    destroyCamp(state); updateConstruction(state);
    expect(house.construction!.duration).toBe(40 / 3);
    expect(house.construction!.waitingForBuilder).toBe(true);
  });

  it('adds the merchant tribe bonus only to completed ordinary caravan journeys', () => {
    const state = fixture('merchants');
    state.factions[0].population = 200;
    for (const city of state.buildings.filter(building => building.kind === 'palace')) { city.capacity = 100; city.unhousedResidents = 100; }
    updateTradeRoutes(state);
    const route = state.tradeRoutes![0], merchant = state.units.find(u => u.id === route.merchantId)!;
    updateMerchant(state, merchant, .1, () => {});
    const planned = route.legValue!.distance;
    Object.assign(merchant, route.goal);
    updateMerchant(state, merchant, .1, () => {});
    const first = domesticTradePayout(planned, 100, 100, 1.15);
    expect(state.factions[0].gold).toBeCloseTo(1000 + first * .75);
    destroyCamp(state); state.time = 2;
    updateMerchant(state, merchant, .1, () => {});
    const returnDistance = route.legValue!.distance;
    Object.assign(merchant, route.goal);
    updateMerchant(state, merchant, .1, () => {});
    expect(state.factions[0].gold).toBeCloseTo(1000 + .75 * (first + domesticTradePayout(returnDistance, 100, 100)));
  });
});
