import { describe, expect, it } from 'vitest';
import { buildingMaintenance, factionBuildingMaintenance } from '../src/game/maintenance';
import { entityStore } from '../src/game/entity-store';
import type { Building, Faction, GameState } from '../src/game/types';

const building = (id: number, kind: Building['kind'], faction = 0, extra: Partial<Building> = {}): Building => ({
  id, kind, faction, x: id, y: 5, hp: 100, maxHp: 100, capacity: 0, ...extra,
});
const faction = (id: number, extra: Partial<Faction> = {}): Faction => ({
  id, name: `Faction ${id}`, color: '#ffffff', affinity: 100, relation: id === 0 ? 'self' : 'peace',
  food: 500, gold: 500, culture: 0, production: 0, population: 20, yields: { food: 0, gold: 0, production: 0 },
  nextRaid: Infinity, defeated: false, ...extra,
});
function fixture(buildings: Building[]): GameState {
  return {
    world: { width: 80, height: 10, seed: 'maintenance', source: 'test', spawns: [], tiles: [] },
    buildings, factions: [faction(0), faction(1), faction(2, { villageId: 1 }), faction(-2)], units: [],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'maintenance', rngState: 1,
  };
}

describe('settlement and watchtower maintenance', () => {
  it('exempts exactly the oldest completed city per faction and charges every completed watchtower', () => {
    const state = fixture([building(30, 'palace'), building(10, 'palace'), building(20, 'palace'),
      building(40, 'woodenTower'), building(41, 'tower'), building(1, 'palace', 1), building(2, 'palace', 1)]);
    const before = JSON.stringify(state);
    expect(state.buildings.map(value => buildingMaintenance(state, value))).toEqual([37.5, 0, 37.5, 5, 5, 0, 37.5]);
    expect(factionBuildingMaintenance(state, state.factions[0])).toBe(85);
    expect(factionBuildingMaintenance(state, state.factions[1])).toBe(37.5);
    expect(JSON.stringify(state)).toBe(before);
    entityStore(state).buildings.replace([...state.buildings].reverse());
    expect(factionBuildingMaintenance(state, state.factions[0])).toBe(85);
    expect(buildingMaintenance(state, state.buildings.find(value => value.id === 10)!)).toBe(0);
  });

  it('ignores unfinished or destroyed buildings and keeps guard bills separate', () => {
    const construction = { startedAt: 0, duration: 90 };
    const state = fixture([building(1, 'palace', 0, { construction }), building(10, 'palace'),
      building(20, 'palace', 0, { hp: 0 }), building(30, 'woodenTower', 0, { construction }),
      building(31, 'woodenTower', 0, { hp: 0 }), building(32, 'guardPost', 0, { guardPost: { level: 2, funded: true, nextUpkeepAt: 30 } }),
      building(33, 'house'), building(34, 'camp'), building(35, 'road'), building(36, 'wall'), building(37, 'well')]);
    expect(state.buildings.map(value => buildingMaintenance(state, value))).toEqual(Array(state.buildings.length).fill(0));
    expect(factionBuildingMaintenance(state, state.factions[0])).toBe(0);
    delete state.buildings[0].construction;
    expect(buildingMaintenance(state, state.buildings[0])).toBe(0);
    expect(buildingMaintenance(state, state.buildings[1])).toBe(37.5);
    expect(factionBuildingMaintenance(state, state.factions[0])).toBe(37.5);
  });

  it('reassigns the one capital exemption immediately after capture and destruction', () => {
    const first = building(10, 'palace'), second = building(20, 'palace');
    const captured = building(3, 'palace', 1), rival = building(30, 'palace', 1);
    const state = fixture([first, second, captured, rival]);
    expect(state.factions.slice(0, 2).map(owner => factionBuildingMaintenance(state, owner))).toEqual([37.5, 37.5]);
    captured.faction = 0;
    expect([first, second, captured, rival].map(value => buildingMaintenance(state, value))).toEqual([37.5, 37.5, 0, 0]);
    expect(state.factions.slice(0, 2).map(owner => factionBuildingMaintenance(state, owner))).toEqual([75, 0]);
    captured.hp = 0;
    expect(factionBuildingMaintenance(state, state.factions[0])).toBe(37.5);
    expect(buildingMaintenance(state, first)).toBe(0);
    first.hp = 0;
    expect(factionBuildingMaintenance(state, state.factions[0])).toBe(0);
    expect(buildingMaintenance(state, second)).toBe(0);
  });

  it('exempts neutral villages, raiders and village property without exempting a normal rival faction', () => {
    const state = fixture([building(1, 'palace', 2), building(2, 'palace', 2), building(3, 'woodenTower', 2),
      building(4, 'palace', -2), building(5, 'palace', -2), building(6, 'woodenTower', -2),
      building(7, 'woodenTower', 0, { villageId: 1 }), building(8, 'palace', 0, { villageId: 1 }),
      building(9, 'palace', 1), building(10, 'palace', 1), building(11, 'woodenTower', 1)]);
    expect(state.buildings.slice(0, 8).map(value => buildingMaintenance(state, value))).toEqual(Array(8).fill(0));
    expect(state.factions.map(owner => factionBuildingMaintenance(state, owner))).toEqual([0, 42.5, 0, 0]);
  });

  it('charges towers even without a surviving city and never scales fees with population or housing', () => {
    const tower = building(1, 'woodenTower'), state = fixture([tower]);
    expect(factionBuildingMaintenance(state, state.factions[0])).toBe(5);
    entityStore(state).buildings.add(building(2, 'palace'), building(3, 'palace'));
    for (const population of [0, 20, 100, 500, 10000]) {
      state.factions[0].population = population;
      state.buildings[2].capacity = population;
      expect(factionBuildingMaintenance(state, state.factions[0])).toBe(42.5);
    }
    tower.hp = 0;
    expect(factionBuildingMaintenance(state, state.factions[0])).toBe(37.5);
  });
});
