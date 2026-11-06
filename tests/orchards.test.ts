import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { FIELD_HARVEST_FOOD, FIELD_HARVEST_SECONDS, synchronizeFarms, updateHarvests, fieldHarvestYield } from '../src/game/farms';
import { orchardUpgradeStatus, purchaseOrchardUpgrade, ORCHARD_ESTABLISH_SECONDS } from '../src/game/orchards';
import { cityDevelopmentNeeds } from '../src/game/governor';
import { updateFog } from '../src/game/fog';
import type { Building, GameState } from '../src/game/types';

function fixture(count = 1): GameState {
  const state: GameState = {
    world: { width: 48, height: 24, seed: 'orchards', source: 'test', spawns: [], tiles: Array.from({ length: 1152 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .7, food: 2, production: 1, gold: 0, variation: .5 })) },
    buildings: [{ id: 1, kind: 'palace', faction: 0, x: 3, y: 10, hp: 650, maxHp: 650, capacity: 0 }],
    units: [{ id: 500, kind: 'leader', faction: 0, x: 7.5, y: 9.5, hp: 100, morale: 100, attack: 20, defense: 5, speed: 3,
      range: 4, order: 'hold', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#d85842', affinity: 100, relation: 'self', gold: 1000, food: 100,
      population: 4, production: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'orchards', rngState: 1,
  };
  for (let i = 0; i < count; i++) entityStore(state).buildings.add({ id: 2 + i, kind: 'camp', faction: 0, x: 7 + i * 3, y: 10, hp: 100, maxHp: 100, capacity: 0 });
  synchronizeFarms(state); return state;
}
const farm = (state: GameState): Building => state.buildings[1];

describe('orchard upgrades', () => {
  it('charges5 gold, suspends growing for120 seconds, and then yields50% more food', () => {
    const state = fixture();
    expect(purchaseOrchardUpgrade(state, farm(state))).toMatchObject({ ok: true });
    expect(state.factions[0].gold).toBe(995);
    expect(farm(state).orchard).toEqual({ startedAt: 0, readyAt: ORCHARD_ESTABLISH_SECONDS });
    state.time = 119.99; synchronizeFarms(state); updateHarvests(state);
    expect(state.fields!.every(field => !field.planted && field.food === 0)).toBe(true);
    expect(fieldHarvestYield(state, state.fields![0])).toBe(0);
    state.time = 120; updateHarvests(state);
    expect(state.fields!.every(field => field.planted && field.food === FIELD_HARVEST_FOOD * 1.5)).toBe(true);
    expect(farm(state).farmFallow).toBe(false);
    state.time = ORCHARD_ESTABLISH_SECONDS + FIELD_HARVEST_SECONDS; updateHarvests(state);
    expect(state.fields![0].food).toBeCloseTo(FIELD_HARVEST_FOOD * 1.5);
    expect(state.factions[0].food).toBe(100);
  });

  it('retains existing bags and their deadlines during conversion, without upgrading old harvested food', () => {
    const state = fixture(), field = state.fields![0];
    field.food = 3; field.foodBatches = [{ amount: 3, expiresAt: 20 }]; field.expiresAt = 20;
    purchaseOrchardUpgrade(state, farm(state));
    expect(field.food).toBe(3); expect(field.expiresAt).toBe(20);
    state.time = 20; updateHarvests(state);
    expect(field.food).toBe(0); expect(state.particles.some(p => p.text === '−3 food')).toBe(true);
    expect(farm(state).orchard?.readyAt).toBe(120);
  });

  it('atomically upgrades the nearest ten eligible farms, with fixed50gold cost', () => {
    const state = fixture(12); state.factions[0].gold = 49.99;
    expect(orchardUpgradeStatus(state, farm(state), 10)).toMatchObject({ available: false, cost: 50 });
    expect(purchaseOrchardUpgrade(state, farm(state), 10).ok).toBe(false);
    expect(state.buildings.some(building => building.orchard)).toBe(false);
    state.factions[0].gold = 50;
    expect(purchaseOrchardUpgrade(state, farm(state), 10).ok).toBe(true);
    expect(state.factions[0].gold).toBe(0);
    expect(state.buildings.filter(building => building.orchard).map(building => building.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(state.fields!.filter(field => field.orchard)).toHaveLength(10);
  });

  it('rejects too few farms, already upgraded farms, and unavailable leader interactions without spending gold', () => {
    const state = fixture(9), gold = state.factions[0].gold;
    expect(purchaseOrchardUpgrade(state, farm(state), 10).ok).toBe(false);
    state.units[0].x = 40; expect(purchaseOrchardUpgrade(state, farm(state)).ok).toBe(false);
    expect(state.factions[0].gold).toBe(gold);
    state.units[0].x = 7.5; expect(purchaseOrchardUpgrade(state, farm(state)).ok).toBe(true);
    expect(purchaseOrchardUpgrade(state, farm(state)).ok).toBe(false);
    expect(state.factions[0].gold).toBe(gold - 5);
  });

  it('preserves desert yield, governor planned capacity, and orchard appearance in fog memories', () => {
    const state = fixture(), fields = state.fields!;
    state.world.tiles[fields[0].y * 48 + fields[0].x].terrain = 'desert';
    purchaseOrchardUpgrade(state, farm(state));
    const needs = cityDevelopmentNeeds(state, state.buildings[0]);
    expect(needs.foodCapacity).toBeCloseTo((.1 * 4 / 3) * 1.5 * .9);
    state.time = 120; updateHarvests(state);
    expect(fields[0].food).toBeCloseTo(FIELD_HARVEST_FOOD / 4 * 1.5);
    const remembered = updateFog(state).fields.find(field => field.id === fields[0].id)!;
    expect(remembered.orchard).toEqual({ startedAt: 0, readyAt: 120 });
    expect(remembered.orchard).not.toBe(farm(state).orchard);
  });
});
