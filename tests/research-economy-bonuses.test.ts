import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { FIELD_SPOIL_SECONDS, synchronizeFarms, updateCollector, updateHarvests } from '../src/game/farms';
import { expireFoodCargo } from '../src/game/food-cargo';
import { domesticTradePayout, updateMerchant, updateTradeRoutes } from '../src/game/trade';
import { houseCapacity, updateWellUpgrades } from '../src/game/wells';
import type { Building, Faction, GameState, ResearchBranchId, Unit } from '../src/game/types';

const building = (id: number, kind: Building['kind'], x: number, y: number, faction = 0): Building =>
  ({ id, kind, x, y, faction, hp: 100, maxHp: 100, capacity: kind === 'house' ? 2 : 0 });
function fixture(): GameState {
  const faction: Faction = { id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 0, gold: 0,
    production: 0, population: 4, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false };
  return {
    world: { width: 40, height: 24, seed: 'research-economy', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 40 * 24 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 5, 5), building(2, 'camp', 10, 5)], units: [], fields: [],
    factions: [faction, { ...faction, id: 1, name: 'Neighbor', relation: 'peace' }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'research-economy', rngState: 1,
  };
}
function learn(state: GameState, technology: ResearchBranchId, factionId = 0): void {
  const faction = state.factions.find(candidate => candidate.id === factionId)!;
  faction.research ??= { focus: 'wall', levels: {}, progress: {} };
  faction.research.levels[technology] = 1;
}

describe('grain storage research', () => {
  it('extends new grain harvest deadlines by fifty percent for the researching faction only', () => {
    const state = fixture(); learn(state, 'grainStorage');
    entityStore(state).buildings.add(building(3, 'camp', 20, 5, 1));
    synchronizeFarms(state);
    for (const field of state.fields!) field.nextHarvest = 30;
    state.time = 30; updateHarvests(state);
    expect(state.fields!.filter(field => field.faction === 0).map(field => field.expiresAt)).toEqual([30 + FIELD_SPOIL_SECONDS * 1.5]);
    expect(state.fields!.filter(field => field.faction === 1).map(field => field.expiresAt)).toEqual([30 + FIELD_SPOIL_SECONDS]);
  });

  it('preserves old batch deadlines when research completes and after both batches are collected', () => {
    const state = fixture(); synchronizeFarms(state);
    const field = state.fields![0];
    for (const other of state.fields!) other.nextHarvest = 1000;
    field.nextHarvest = 30; state.time = 30; updateHarvests(state);
    expect(field.expiresAt).toBe(30 + FIELD_SPOIL_SECONDS);
    state.time = 32; learn(state, 'grainStorage'); updateHarvests(state);
    expect(field.expiresAt).toBe(30 + FIELD_SPOIL_SECONDS);
    field.nextHarvest = 35; state.time = 35; updateHarvests(state); field.nextHarvest = 1000;
    expect(field.foodBatches!.map(batch => batch.expiresAt)).toEqual([30 + FIELD_SPOIL_SECONDS, 35 + FIELD_SPOIL_SECONDS * 1.5]);
    const courier: Unit = { id: 10, kind: 'worker', faction: 0, home: 1, collectorCamp: 2, collector: true,
      x: field.x + .5, y: field.y + .5, field: field.id, collectPhase: 'outbound', hp: 50, morale: 100,
      attack: 0, defense: 0, speed: 2.2, range: 1.1, order: 'work', cooldown: 0, lastCombat: -60,
      moving: false, facing: 0, attackTime: 0 };
    entityStore(state).units.add(courier);
    state.time = 36; updateCollector(state, courier, .1, () => {});
    expect(field.food).toBe(0);
    expect(courier.cargoBatches!.map(batch => batch.expiresAt)).toEqual([30 + FIELD_SPOIL_SECONDS, 35 + FIELD_SPOIL_SECONDS * 1.5]);
    state.time = 30 + FIELD_SPOIL_SECONDS; expireFoodCargo(state, courier);
    expect(courier.cargoBatches!.map(batch => batch.expiresAt)).toEqual([35 + FIELD_SPOIL_SECONDS * 1.5]);
    state.time = 35 + FIELD_SPOIL_SECONDS * 1.5; expireFoodCargo(state, courier);
    expect(courier.cargo).toBe(0);
  });

  it('does not extend orchard fruit storage', () => {
    const state = fixture(); learn(state, 'grainStorage');
    state.buildings[1].orchard = { startedAt: -120, readyAt: 0 };
    synchronizeFarms(state);
    for (const field of state.fields!) field.nextHarvest = 30;
    state.time = 30; updateHarvests(state);
    expect(state.fields!.map(field => field.expiresAt)).toEqual([30 + FIELD_SPOIL_SECONDS]);
  });
});

describe('coinage research', () => {
  it('adds twenty percent to actual caravan deliveries and stacks with regional specialties', () => {
    const state = fixture(); learn(state, 'coinage');
    entityStore(state).buildings.replace([building(1, 'palace', 5, 8), building(3, 'palace', 30, 8)]);
    state.factions[0].population = 200;
    for (const city of state.buildings) { city.capacity = 100; city.unhousedResidents = 100; }
    for (let y = 6; y <= 8; y++) state.world.tiles[y * state.world.width + 4].resource = 'clay';
    updateTradeRoutes(state);
    const route = state.tradeRoutes![0], merchant = state.units.find(unit => unit.id === route.merchantId)!;
    updateMerchant(state, merchant, .1, () => {});
    const planned = route.legValue!.distance;
    Object.assign(merchant, route.goal);
    updateMerchant(state, merchant, .1, () => {});
    const expected = domesticTradePayout(planned, 100, 100, 1.05 * 1.2);
    expect(state.factions[0].gold).toBeCloseTo(expected);
    expect(state.factions[1].gold).toBe(0);
    expect(route.journeys).toBe(1);
    expect(state.particles.some(particle => particle.text === `+${Math.round(expected)} gold`)).toBe(true);
  });
});

describe('urban planning research', () => {
  it('adds one place at every housing tier and stacks with the redevelopment bonus', () => {
    const state = fixture(); learn(state, 'urbanPlanning');
    for (const [tier, capacity] of [[1, 2], [2, 3], [3, 4], [4, 5]]) {
      const home = { ...building(20, 'house', 14, 8), houseLevel: tier };
      expect(houseCapacity(home, state.factions[0])).toBe(capacity + 1);
      expect(houseCapacity({ ...home, redevelopedFarm: true }, state.factions[0])).toBe(capacity + 2);
      expect(houseCapacity(home, state.factions[1])).toBe(capacity);
    }
  });

  it('refreshes existing, new and reassigned homes without accumulating bonuses', () => {
    const state = fixture(), home = building(20, 'house', 14, 8);
    entityStore(state).buildings.add(home);
    updateWellUpgrades(state); expect(home.capacity).toBe(2);
    learn(state, 'urbanPlanning'); updateWellUpgrades(state); expect(home.capacity).toBe(3);
    const newHome = { ...building(21, 'house', 16, 8), redevelopedFarm: true };
    entityStore(state).buildings.add(newHome);
    synchronizeFarms(state); synchronizeFarms(state);
    expect(home.capacity).toBe(3); expect(newHome.capacity).toBe(4);
    home.faction = 1; updateWellUpgrades(state); expect(home.capacity).toBe(2);
  });
});
